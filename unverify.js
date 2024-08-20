const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createPendingEmbed, createFailedEmbed, createSuccessEmbed, createLogEmbed } = require('../embeds/statusEmbed');
const VerifiedRobloxAccount = require('../Schema/verificationSchema');
const BindingSchemaLog = require('../Schema/bindingSchema');
const { isConfigComplete } = require('../handlers/configHandler');

const makeChannelRoleId = JSON.parse(fs.readFileSync(path.join(__dirname, '../Config/makeChannelRoleId.json'), 'utf-8'));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unverify')
        .setDescription('Unverify Discord account from Roblox.'),

    async execute(interaction) {
        if (!isConfigComplete()) {
            return interaction.reply({
                content: 'The configuration is not complete. Please fill all required fields. Please use /setup.',
                ephemeral: true
            });
        }

        try {
            const discordId = interaction.user.id;

            const existingVerification = await VerifiedRobloxAccount.findOne({ discordId });

            if (existingVerification) {
                const robloxUsername = existingVerification.robloxUsername;
                const robloxId = existingVerification.robloxId;
                const robloxURL = `https://www.roblox.com/users/${robloxId}/profile`;

                const yesButton = new ButtonBuilder()
                    .setCustomId('yes_verification')
                    .setLabel('Yes')
                    .setStyle(ButtonStyle.Success);

                const cancelVerificationButton = new ButtonBuilder()
                    .setCustomId('cancel_verification')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger);

                const row = new ActionRowBuilder()
                    .addComponents(yesButton, cancelVerificationButton);

                const confirmationEmbed = createPendingEmbed(interaction.guild.name, 'Unverify')
                    .setTitle('Unverification Confirmation')
                    .setDescription(`Are you sure you want to unverify your Roblox account (${robloxUsername})? This action cannot be undone.`);

                await interaction.reply({ embeds: [confirmationEmbed], components: [row], ephemeral: true });

                const filter = i => i.user.id === interaction.user.id;
                const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

                collector.on('collect', async i => {
                    if (!i.isButton()) return;

                    if (i.customId === 'yes_verification') {
                        try {
                            const guildMember = await interaction.guild.members.fetch(discordId);
                            if (!guildMember) {
                                console.warn(`Member with ID ${discordId} not found in the cache.`);
                                return await i.update({
                                    embeds: [createFailedEmbed(interaction.guild.name, 'Unverify')
                                        .setTitle('Operation Failed')
                                        .setDescription('Member not found.')],
                                    components: [],
                                    ephemeral: true
                                });
                            }

                            const userRoles = guildMember.roles.cache.map(role => role.id);
                            console.log(`Roles of user ${discordId}: ${userRoles.join(', ')}`);

                            const bindings = await BindingSchemaLog.find({
                                serverId: Number(interaction.guild.id),
                                discordRoleIds: { $in: userRoles }
                            }).exec();

                            console.log(`Bindings retrieved from database: ${JSON.stringify(bindings)}`);

                            if (bindings.length === 0) {
                                console.log(`No bindings found for Discord ID: ${discordId}`);
                            }

                            for (const binding of bindings) {
                                const discordRoleIds = binding.discordRoleIds;

                                for (const roleId of discordRoleIds) {
                                    if (userRoles.includes(roleId)) {
                                        const role = interaction.guild.roles.cache.get(roleId);
                                        if (role) {
                                            await guildMember.roles.remove(role)
                                                .catch(err => console.error(`Failed to remove role ${roleId}:`, err));
                                        } else {
                                            console.warn(`Role with ID ${roleId} not found in the cache.`);
                                        }
                                    }
                                }
                            }

                            // Delete the verification record and add a delay
                            await VerifiedRobloxAccount.findOneAndDelete({ discordId });
                            await delay(500); // Wait for database to update
                            await VerifiedRobloxAccount.findOneAndDelete({ discordId });

                            const verifiedRoleId = makeChannelRoleId.RoleId.verifiedRoleId[0];
                            const verifiedRole = interaction.guild.roles.cache.get(verifiedRoleId);
                            if (verifiedRole) {
                                await guildMember.roles.remove(verifiedRole)
                                    .catch(err => console.error(`Failed to remove verified role ${verifiedRoleId}:`, err));
                            } else {
                                console.warn(`Verified role with ID ${verifiedRoleId} not found in the cache.`);
                            }

                            try {
                                await guildMember.setNickname(null);
                                console.log(`Cleared nickname for ${interaction.user.tag}`);
                            } catch (error) {
                                console.error(`Failed to clear nickname for ${interaction.user.tag}:`, error);
                            }

                            const successEmbed = createSuccessEmbed(interaction.guild.name, 'Unverify')
                                .setTitle('Unverified')
                                .setDescription(`Your Roblox account **${robloxUsername}** has been unverified.`);
                            
                            await i.update({ embeds: [successEmbed], components: [], ephemeral: true });

                            const verificationLog = makeChannelRoleId.ChannelId.verificationLog;
                            const logChannel = interaction.guild.channels.cache.get(verificationLog);
                            if (logChannel) {
                                const verificationLoggingEmbed = createLogEmbed(interaction.guild.name, "Unverify")
                                    .setTitle("User Unverified")
                                    .setDescription(`User <@${discordId}> (${discordId}) has been unverified as [${robloxUsername}](${robloxURL}).`);
                            
                                await logChannel.send({ embeds: [verificationLoggingEmbed] });
                            } else {
                                console.warn(`Log channel with ID ${verificationLog} not found.`);
                            }
                        } catch (err) {
                            console.error('An error occurred during unverification:', err);
                            await i.update({
                                embeds: [createFailedEmbed(interaction.guild.name, 'Unverify')
                                    .setTitle('Operation Failed')
                                    .setDescription('An error occurred while trying to unverify your account.')],
                                components: [],
                                ephemeral: true
                            });
                        }
                    }

                    if (i.customId === 'cancel_verification') {
                        const cancelEmbed = createFailedEmbed(interaction.guild.name, 'Unverify')
                            .setTitle('Operation Cancelled')
                            .setDescription('The unverification process has been cancelled.');

                        await i.update({ embeds: [cancelEmbed], components: [], ephemeral: true });
                    }

                    collector.stop();
                });

            } else {
                const notVerifiedEmbed = createFailedEmbed(interaction.guild.name, 'Unverify')
                    .setTitle('Operation Failed')
                    .setDescription('You are not verified!');

                return await interaction.reply({ embeds: [notVerifiedEmbed], ephemeral: true });
            }
        } catch (error) {
            console.error('An error occurred while processing the unverify command:', error);
            await interaction.reply({
                content: 'An error occurred while trying to unverify your account. Please try again later.',
                ephemeral: true
            });
        }
    }
};
