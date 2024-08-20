const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const noblox = require('noblox.js');
const { createPendingEmbed, createFailedEmbed, createSuccessEmbed, createLogEmbed } = require('../embeds/statusEmbed');
const { isConfigComplete } = require('../handlers/configHandler');
const randomWords = require('../Config/randomWords.json');
const VerifiedRobloxAccount = require('../Schema/verificationSchema');
const axios = require("axios");

// Function to generate a random phrase based on user ID
function generateRandomPhrase(authorId) {
    let words = [];
    for (let i = 0; i < authorId.length; i++) {
        words.push(randomWords[i][authorId[i]]);
    }
    return words.join(' '); // Join words into a single phrase
}

// Load the makeChannelRoleId.json file
const makeChannelRoleId = JSON.parse(fs.readFileSync(path.join(__dirname, '../Config/makeChannelRoleId.json'), 'utf-8'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify Discord with Roblox.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to verify')
                .setRequired(true)),

    async execute(interaction) {
        if (!isConfigComplete()) {
            return interaction.reply({
                content: 'The configuration is not complete. Please fill all required fields. Please use /setup.',
                ephemeral: true
            });
        }

        const username = interaction.options.getString('username');
        const discordId = interaction.user.id;

        try {
            if (interaction.replied || interaction.deferred) {
                console.log("Interaction already replied or deferred.");
                return;
            }
            
            const robloxId = await noblox.getIdFromUsername(username);
            const robloxURL = `https://www.roblox.com/users/${robloxId}/profile`;
            const thumbnails = await noblox.getPlayerThumbnail([robloxId], "720x720", "png", false, "body");

            const existingVerification = await VerifiedRobloxAccount.findOne({ discordId });
            if (existingVerification) {
                const embed = createFailedEmbed(interaction.guild.name, 'Verify')
                    .setTitle('Operation Failed')
                    .setDescription(`You are already verified with the following account:\n**Username:** ${existingVerification.robloxUsername}\n**Roblox ID:** ${existingVerification.robloxId}`);
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            const yesButton = new ButtonBuilder()
                .setCustomId('verify_yes')
                .setLabel('Yes')
                .setStyle(ButtonStyle.Success);

            const noButton = new ButtonBuilder()
                .setCustomId('verify_no')
                .setLabel('No')
                .setStyle(ButtonStyle.Danger);

            const row = new ActionRowBuilder()
                .addComponents(yesButton, noButton);

            const confirmationEmbed = createPendingEmbed(interaction.guild.name, 'Verify')
                .setTitle('Verification Step 1 - Confirmation')
                .setDescription(`We have found your Roblox profile! Are you sure this is you?\n\n**Username:** [${username} (${robloxId})](${robloxURL})`)
                .setThumbnail(thumbnails[0].imageUrl);

            await interaction.reply({ embeds: [confirmationEmbed], components: [row], ephemeral: true });

            const filter = i => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

            collector.on('collect', async i => {
                if (!i.isButton()) return;

                try {
                    if (i.customId === 'verify_yes') {
                        const randomPhrase = generateRandomPhrase(discordId);

                        const doneButton = new ButtonBuilder()
                            .setCustomId('done_verification')
                            .setLabel('DONE')
                            .setStyle(ButtonStyle.Success);

                        const cancelVerificationButton = new ButtonBuilder()
                            .setCustomId('cancel_verification')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Danger);

                        const row2 = new ActionRowBuilder()
                            .addComponents(doneButton, cancelVerificationButton);

                        const randomSentenceEmbed = createPendingEmbed(interaction.guild.name, 'Verify')
                            .setTitle('Verification Step 2 - Random Phrase')
                            .setDescription(`Please set your Roblox status to the following random phrase for verification:\n\n**${randomPhrase}**`);

                        await i.update({ embeds: [randomSentenceEmbed], components: [row2] });
                        collector.stop();

                        const secondCollector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

                        secondCollector.on("collect", async i => {
                            if (!i.isButton()) return;

                            try {
                                if (i.customId === "done_verification") {
                                    const userResponse = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
                                    const userDescription = userResponse.data.description;

                                    if (userDescription && userDescription.includes(randomPhrase)) {
                                        // Save verified account to the database
                                        const newVerifiedAccount = new VerifiedRobloxAccount({
                                            robloxUsername: username,
                                            robloxId: robloxId,
                                            discordId: discordId                                            
                                        });
                                        await newVerifiedAccount.save();

                                        // Assign the verified role
                                        const guildMember = interaction.guild.members.cache.get(discordId);
                                        if (guildMember) {
                                            const verifiedRoleId = makeChannelRoleId.RoleId.verifiedRoleId[0];
                                            await guildMember.roles.add(verifiedRoleId);
                                        }

                                        // Update the user's Discord nickname to the Roblox username
                                        try {
                                            await guildMember.setNickname(username);
                                            console.log(`Updated ${interaction.user.tag}'s nickname to ${username}`);
                                        } catch (error) {
                                            console.error(`Failed to update ${interaction.user.tag}'s nickname:`, error);
                                        }

                                       

                                        const successfulVerification = createSuccessEmbed(interaction.guild.name, "Verify")
                                            .setTitle("Verification Successful")
                                            .setDescription(`Verified with [${username} (${robloxId})](${robloxURL})`)
                                            .setThumbnail(thumbnails[0].imageUrl);

                                        if (!i.replied && !i.deferred) {
                                            await i.update({ embeds: [successfulVerification], components: [] });
                                            const verificationLog = makeChannelRoleId.ChannelId.verificationLog;
                                            const logChannel = interaction.guild.channels.cache.get(verificationLog);
                                            if (logChannel) {
                                                const verificationLoggingEmbed = createLogEmbed(interaction.guild.name, "Verify")
                                                    .setTitle("User Verified")
                                                    .setDescription(`User <@${discordId}> (${discordId}) has successfully verified as [${username}](${robloxURL}).`)
                                                    .setThumbnail(thumbnails[0].imageUrl);
                                            
                                                // Send the embed wrapped in an object
                                                await logChannel.send({ embeds: [verificationLoggingEmbed] });
                                            }
                                        } else {
                                            console.log("Interaction already replied or deferred.");
                                        }
                                    } else {
                                        const descriptionNotMatching = createFailedEmbed(interaction.guild.name, 'Verify')
                                            .setTitle('Operation Cancelled')
                                            .setDescription('The random phrase was not found in your description!');

                                        if (!i.replied && !i.deferred) {
                                            await i.update({ embeds: [descriptionNotMatching], components: [] });
                                        } else {
                                            console.log("Interaction already replied or deferred.");
                                        }
                                    }
                                } else if (i.customId === "cancel_verification") {
                                    const cancelledVerificationEmbed = createFailedEmbed(interaction.guild.name, "Verify")
                                        .setTitle("Verification Cancelled")
                                        .setDescription("You have cancelled this verification process.");
                                    if (!i.replied && !i.deferred) {
                                        await i.update({ embeds: [cancelledVerificationEmbed], components: [] });
                                    } else {
                                        console.log("Interaction already replied or deferred.");
                                    }
                                    secondCollector.stop();
                                }
                            } catch (error) {
                                console.error('An error occurred while processing the button interaction:', error);
                                if (!i.replied && !i.deferred) {
                                    await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
                                }
                            }
                        });

                        secondCollector.on('end', collected => {
                            if (collected.size === 0) {
                                if (!interaction.replied && !interaction.deferred) {
                                    interaction.editReply({ content: 'You did not respond in time. Verification process cancelled.', components: [] });
                                }
                            }
                        });
                    } else if (i.customId === 'verify_no') {
                        const cancelledEmbed = createFailedEmbed(interaction.guild.name, 'Verify')
                            .setTitle('Operation Cancelled')
                            .setDescription('The verification process has been cancelled.');

                        if (!i.replied && !i.deferred) {
                            await i.update({ embeds: [cancelledEmbed], components: [] });
                        } else {
                            console.log("Interaction already replied or deferred.");
                        }
                        collector.stop();
                    }
                } catch (error) {
                    console.error('An error occurred while processing the button interaction:', error);
                    if (!i.replied && !i.deferred) {
                        await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
                    }
                }
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    if (!interaction.replied && !interaction.deferred) {
                        interaction.editReply({ content: 'You did not respond in time. Verification process cancelled.', components: [] });
                    }
                }
            });

        } catch (error) {
            console.error('An error occurred during the verification process:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred while fetching Roblox information. Please try again later.', ephemeral: true });
            }
        }
    }
};
