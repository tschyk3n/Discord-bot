const { SlashCommandBuilder } = require('discord.js');
const RobloxVerifiedAccount = require('../Schema/verificationSchema');
const BindingSchemaLog = require('../Schema/bindingSchema');
const { createSuccessEmbed, createFailedEmbed, createPendingEmbed } = require('../embeds/statusEmbed');
const axios = require('axios');

const MAX_RETRIES = 3;  // Number of retry attempts for adding roles
const COOLDOWN_MS = 2000;  // Cooldown time between operations in milliseconds

async function addRoleWithRetry(member, role, retries = MAX_RETRIES) {
    try {
        await member.roles.add(role);
    } catch (error) {
        if (retries > 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await addRoleWithRetry(member, role, retries - 1);
        }
    }
}

async function removeRoleWithRetry(member, role, retries = MAX_RETRIES) {
    try {
        await member.roles.remove(role);
    } catch (error) {
        if (retries > 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await removeRoleWithRetry(member, role, retries - 1);
        }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Update Roblox username and roles')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to update')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const discordId = user.id;
        const member = interaction.guild.members.cache.get(discordId);
        const serverId = interaction.guild.id;

        if (!member) {
            const failedEmbed = createFailedEmbed(interaction.guild.name, "Update")
                .setDescription('❌ Member not found in the guild.');
            await interaction.reply({ embeds: [failedEmbed] });
            return;
        }

        try {
            // Send a "thinking" message
            const pendingEmbed = createPendingEmbed(interaction.guild.name, "Update")
                .setDescription('🔄 Processing updates. Please wait...');
            const replyMessage = await interaction.reply({ embeds: [pendingEmbed], fetchReply: true });

            // Fetch the user record from the database
            const userRecord = await RobloxVerifiedAccount.findOne({ discordId });
            if (!userRecord) {
                const failedEmbed = createFailedEmbed(interaction.guild.name, "Update")
                    .setDescription('❌ User not found in the database.');
                await replyMessage.edit({ embeds: [failedEmbed] });
                return;
            }

            // Fetch the Roblox user's details
            const userResponse = await axios.get(`https://users.roblox.com/v1/users/${userRecord.robloxId}`);
            const newRobloxUsername = userResponse.data.name;

            // Check if the username has changed
            let usernameChanged = false;
            if (userRecord.robloxUsername !== newRobloxUsername) {
                usernameChanged = true;
                userRecord.robloxUsername = newRobloxUsername;
                await userRecord.save();

                // Update the Discord nickname to match the new Roblox username
                try {
                    await member.setNickname(newRobloxUsername);
                } catch (nicknameError) {
                    console.error('Error updating nickname:', nicknameError);
                }
            }

            // Prepare to update roles
            const groupResponse = await axios.get(`https://groups.roblox.com/v2/users/${userRecord.robloxId}/groups/roles`);
            const groups = groupResponse.data.data;

            // Fetch the role bindings
            const bindings = await BindingSchemaLog.find({ serverId });
            const rankToRoleMap = {};

            bindings.forEach(binding => {
                rankToRoleMap[binding.robloxRankId] = binding.discordRoleIds;
            });

            let rolesToAdd = new Set();

            // Determine which roles to add based on Roblox roles
            if (groups.length > 0) {
                groups.forEach(groupData => {
                    const roleId = groupData.role.id;
                    const robloxRankId = roleId.toString();

                    if (rankToRoleMap[robloxRankId]) {
                        rankToRoleMap[robloxRankId].forEach(discordRoleId => rolesToAdd.add(discordRoleId));
                    }
                });
            }

            // Determine which roles to remove
            const allRoleIdsInBindings = new Set();
            bindings.forEach(binding => {
                binding.discordRoleIds.forEach(roleId => allRoleIdsInBindings.add(roleId));
            });

            const currentRoles = member.roles.cache.map(role => role.id);
            const rolesToRemove = currentRoles.filter(roleId => allRoleIdsInBindings.has(roleId) && !rolesToAdd.has(roleId));

            // Remove roles one by one
            for (const roleId of rolesToRemove) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    await removeRoleWithRetry(member, role);
                    await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
                }
            }

            // Ensure roles are removed before adding new ones
            await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));

            // Add roles one by one
            for (const roleId of rolesToAdd) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    await addRoleWithRetry(member, role);
                    await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
                }
            }

            // Prepare success message
            const nameStatus = usernameChanged ? ':white_check_mark:' : ':x:';
            const successEmbed = createSuccessEmbed(interaction.guild.name, "Update")
                .addFields(
                    { name: 'Username', value: nameStatus, inline: true },
                    { name: 'Roles', value: '✅', inline: true }
                );

            await replyMessage.edit({ embeds: [successEmbed] });

        } catch (error) {
            console.error('Error occurred during the update command execution:', error);

            const errorEmbed = createFailedEmbed(interaction.guild.name, "Update")
                .setDescription('❌ Error occurred during the update process.');
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
