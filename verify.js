
const fs = require('fs'); 
const path = require('path');
const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js'); 
const noblox = require('noblox.js'); 
const { createPendingEmbed, createFailedEmbed, createSuccessEmbed, createLogEmbed } = require('../embeds/statusEmbed'); // Custom embed creators for status messages
const { isConfigComplete } = require('../handlers/configHandler'); // Function to check if the configuration is complete
const randomWords = require('../Config/randomWords.json'); // JSON file containing random words for generating phrases
const VerifiedRobloxAccount = require('../Schema/verificationSchema'); // MongoDB schema for storing verified Roblox accounts
const axios = require("axios"); 

// Function to generate a random phrase based on user ID
function generateRandomPhrase(authorId) {
    let words = [];
    for (let i = 0; i < authorId.length; i++) {
        words.push(randomWords[i][authorId[i]]); // Retrieve random word based on each character in the authorId
    }
    return words.join(' '); // Join words into a single phrase
}

// Load the configuration for role and channel IDs
const makeChannelRoleId = JSON.parse(fs.readFileSync(path.join(__dirname, '../Config/makeChannelRoleId.json'), 'utf-8'));

// Command Structure for the /verify command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify Discord with Roblox.')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to verify')
                .setRequired(true)),

    async execute(interaction) {
        // Check if the configuration is complete
        if (!isConfigComplete()) {
            return interaction.reply({
                content: 'The configuration is not complete. Please fill all required fields. Please use /setup.',
                ephemeral: true
            });
        }

        const username = interaction.options.getString('username'); // Get Roblox username from command options
        const discordId = interaction.user.id; // Get Discord ID of the user executing the command

        try {
            // Check if the interaction has already been replied or deferred
            if (interaction.replied || interaction.deferred) {
                console.log("Interaction already replied or deferred.");
                return;
            }
            
            // Get Roblox ID from the username
            const robloxId = await noblox.getIdFromUsername(username);
            const robloxURL = `https://www.roblox.com/users/${robloxId}/profile`; // URL to the Roblox profile
            const thumbnails = await noblox.getPlayerThumbnail([robloxId], "720x720", "png", false, "body"); // Get profile thumbnail

            // Check if the user is already verified
            const existingVerification = await VerifiedRobloxAccount.findOne({ discordId });
            if (existingVerification) {
                const embed = createFailedEmbed(interaction.guild.name, 'Verify')
                    .setTitle('Operation Failed')
                    .setDescription(`You are already verified with the following account:\n**Username:** ${existingVerification.robloxUsername}\n**Roblox ID:** ${existingVerification.robloxId}`);
                return await interaction.reply({ embeds: [embed], ephemeral: true });
            }

            // Create "Yes" and "No" buttons for verification confirmation
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

            // Create the confirmation embed
            const confirmationEmbed = createPendingEmbed(interaction.guild.name, 'Verify')
                .setTitle('Verification Step 1 - Confirmation')
                .setDescription(`We have found your Roblox profile! Are you sure this is you?\n\n**Username:** [${username} (${robloxId})](${robloxURL})`)
                .setThumbnail(thumbnails[0].imageUrl);

            await interaction.reply({ embeds: [confirmationEmbed], components: [row], ephemeral: true });

            // Filter for button interactions from the user who executed the command
            const filter = i => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

            collector.on('collect', async i => {
                if (!i.isButton()) return; // Only process button interactions

                try {
                    if (i.customId === 'verify_yes') {
                        // Generate a random phrase for the user to set as their Roblox status
                        const randomPhrase = generateRandomPhrase(discordId);

                        // Create "DONE" and "Cancel" buttons for the next step
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

                        // Create the embed instructing the user to set their status
                        const randomSentenceEmbed = createPendingEmbed(interaction.guild.name, 'Verify')
                            .setTitle('Verification Step 2 - Random Phrase')
                            .setDescription(`Please set your Roblox status to the following random phrase for verification:\n\n**${randomPhrase}**`);

                        await i.update({ embeds: [randomSentenceEmbed], components: [row2] });
                        collector.stop(); // Stop the initial collector

                        // Create a second collector for the "DONE" and "Cancel" buttons
                        const secondCollector = interaction.channel.createMessageComponentCollector({ filter, time: 15000 });

                        secondCollector.on("collect", async i => {
                            if (!i.isButton()) return;

                            try {
                                if (i.customId === "done_verification") {
                                    // Check if the user's Roblox status contains the random phrase
                                    const userResponse = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
                                    const userDescription = userResponse.data.description;

                                    if (userDescription && userDescription.includes(randomPhrase)) {
                                        // Save the verified account to the database
                                        const newVerifiedAccount = new VerifiedRobloxAccount({
                                            robloxUsername: username,
                                            robloxId: robloxId,
                                            discordId: discordId                                            
                                        });
                                        await newVerifiedAccount.save();

                                        // Assign the verified role to the user
                                        const guildMember = interaction.guild.members.cache.get(discordId);
                                        if (guildMember) {
                                            const verifiedRoleId = makeChannelRoleId.RoleId.verifiedRoleId[0];
                                            await guildMember.roles.add(verifiedRoleId);
                                        }

                                        // Update the user's Discord nickname to their Roblox username
                                        try {
                                            await guildMember.setNickname(username);
                                            console.log(`Updated ${interaction.user.tag}'s nickname to ${username}`);
                                        } catch (error) {
                                            // Handle error if unable to update nicknames (Happens if the bot does not have enough permission to update)
                                            console.error(`Failed to update ${interaction.user.tag}'s nickname:`, error);
                                        }

                                        // Send a success message
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
                                            
                                                await logChannel.send({ embeds: [verificationLoggingEmbed] });
                                            }
                                        } else {
                                            console.log("Interaction already replied or deferred.");
                                        }
                                    } else {
                                        // If the phrase does not match, notify the user
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
                                    // Handle cancellation of the verification process
                                    const cancelledVerificationEmbed = createFailedEmbed(interaction.guild.name, "Verify")
                                        .setTitle("Verification Cancelled")
                                        .setDescription("You have cancelled this verification process.");
                                    if (!i.replied && !i.deferred) {
                                        await i.update({ embeds: [cancelledVerificationEmbed], components: [] });
                                    } else {
                                        console.log("Interaction already replied or deferred.");
                                    }
                                    secondCollector.stop(); // Stop the collector
                                }
                            } catch (error) {
                                // Handle errors during button interactions
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
                        // Handle the case where the user chooses not to verify
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
                    // Handles errors during button interactions
                    console.error('An error occurred while processing the button interaction:', error);
                    if (!i.replied && !i.deferred) {
                        await i.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
                    }
                }
            });
            // If user did not respond
            collector.on('end', collected => { 
                if (collected.size === 0) {
                    if (!interaction.replied && !interaction.deferred) {
                        interaction.editReply({ content: 'You did not respond in time. Verification process cancelled.', components: [] });
                    }
                }
            });

        } catch (error) {
            // Handle error during the verifcation process
            console.error('An error occurred during the verification process:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred while fetching Roblox information. Please try again later.', ephemeral: true });
            }
        }
    }
};

