const { SlashCommandBuilder } = require('discord.js');
const noblox = require('noblox.js');
const axios = require('axios');
const { createFailedEmbed, createLogEmbed, createSuccessEmbed } = require('../embeds/statusEmbed');
const { isConfigComplete } = require('../handlers/configHandler');
const banSchema1 = require('../Schema/banSchema');
const { startServer } = require('../server');
const path = require('path');
const fs = require('fs');

const makeChannelRoleIdPath = path.join(__dirname, '../Config/makeChannelRoleId.json');
const makeChannelRoleId = JSON.parse(fs.readFileSync(makeChannelRoleIdPath, 'utf-8'));

function hasPermission(member) {
    const config = JSON.parse(fs.readFileSync(makeChannelRoleIdPath, 'utf8'));
    const banIds = config.RoleId.BanPermId;
    return banIds.some(roleId => member.roles.cache.has(roleId));
}

async function isUserAlreadyBanned(robloxId) {
    return await banSchema1.findOne({ robloxId: robloxId });
}



module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from Roblox with a reason and duration.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('roblox')
                .setDescription('Ban a Roblox user')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The username of the Roblox user')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for banning')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('duration')
                        .setDescription('Duration of the ban in minutes')
                        .setRequired(true))),
    
    async execute(interaction) {
        if (!isConfigComplete()) {
            return interaction.reply({
                content: 'The configuration is not complete. Please fill all required fields. Please use /setup.',
                ephemeral: true
            });
        }

        if (!hasPermission(interaction.member)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        const username = interaction.options.getString('username');
        const reason = interaction.options.getString('reason');
        const duration = interaction.options.getInteger('duration');

        try {
            const robloxId = await noblox.getIdFromUsername(username);
            const existingBan = await isUserAlreadyBanned(robloxId);
            if (existingBan) {
                await interaction.reply({
                    content: 'This user is already banned.',
                    ephemeral: true
                });
                return;
            }

           

            // Calculate the expiry timestamp
            const expiryTimestamp = Math.floor(Date.now() / 1000) + duration * 60; // Duration in seconds

            const newBan = new banSchema1({
                robloxUsername: username,
                robloxId: robloxId,
                reason: reason,
                durationInMin: duration,
                expiryTimestamp: expiryTimestamp
            });

            await newBan.save();

            const successfulBannedEmbed = createSuccessEmbed(interaction.guild.name, "Ban")
                .setDescription(`You have banned ${username} (${robloxId}) for ${reason}. Ban expires at <t:${expiryTimestamp}:R>.`);

            await interaction.reply({ embeds: [successfulBannedEmbed], components: [], ephemeral: true });

            startServer({ robloxId, reason, duration, action: "Ban" });

            const banLogChannel = makeChannelRoleId.ChannelId.logChannel;
            const logChannel = interaction.guild.channels.cache.get(banLogChannel);
            if (logChannel) {
                const banLoggingEmbed = createLogEmbed(interaction.guild.name, "Ban")
                    .setTitle("User Banned")
                    .setDescription(`<@${interaction.user.id}> has banned Roblox user **${username}** (ID: ${robloxId}) for **${reason}**. Ban expires at <t:${expiryTimestamp}:R>.`);

                await logChannel.send({ embeds: [banLoggingEmbed] });
            }
        } catch (error) {
            console.error('Error executing the ban command:', error);
            await interaction.reply({
                embeds: [createFailedEmbed(interaction.guild.name, 'Failed to ban the user')],
                ephemeral: true
            });
        }
    }
};
