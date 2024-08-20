const { SlashCommandBuilder } = require('discord.js');
const noblox = require('noblox.js');
const fs = require('fs');
const path = require('path');
const pointsSchema = require('../Schema/pointSchema'); // Adjust the path as needed
const { createFailedEmbed, createLogEmbed, createSuccessEmbed } = require('../embeds/statusEmbed');

// Read and parse the JSON configuration file for paths
const configPath = path.join(__dirname, '../Config/makeChannelRoleId.json');
const makeChannelRoleId = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Extract relevant data from the parsed configuration
const pointsIdRoleIds = makeChannelRoleId.RoleId.PointsId;
const logChannelId = makeChannelRoleId.ChannelId.logChannel;

function hasPermission(member) {
    return pointsIdRoleIds.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('points')
        .setDescription('Add or Remove points.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add points to users')
                .addStringOption(option =>
                    option.setName('usernames')
                        .setDescription('Comma separated list of usernames')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of points to add')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove points from users')
                .addStringOption(option =>
                    option.setName('usernames')
                        .setDescription('Comma separated list of usernames')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of points to remove')
                        .setRequired(true))),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const usernames = interaction.options.getString('usernames').split(',').map(name => name.trim());
        const amount = interaction.options.getInteger('amount');

        if (!hasPermission(interaction.member)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        // Check if the number of usernames exceeds the limit
        if (usernames.length > 10) {
            const moreThan10UsernameEmbed = createFailedEmbed(interaction.guild.name, "Points")
                .setDescription(`You can specify a maximum of 10 usernames.`);
            return await interaction.reply({ embeds: [moreThan10UsernameEmbed], ephemeral: true });
        }

        // Check if the amount is valid
        if (amount <= 0) {
            const pointAmountNotRightEmbed = createFailedEmbed(interaction.guild.name, "Points")
                .setDescription(`Amount must be greater than 0.`);
            return await interaction.reply({ embeds: [pointAmountNotRightEmbed], ephemeral: true });
        }

        try {
            // Fetch Roblox IDs for all usernames
            const robloxIdResults = await Promise.all(usernames.map(async (username) => {
                const robloxId = await getRobloxId(username);
                return { username, robloxId };
            }));

            const failedUsers = robloxIdResults.filter(({ robloxId }) => !robloxId);
            const successfulUsers = robloxIdResults.filter(({ robloxId }) => robloxId);

            // Process each successful user
            for (const { username, robloxId } of successfulUsers) {
                await updatePoints(robloxId, amount, subcommand === 'add');
            }

            // Build the response message
            let responseMessage = '';
            let successEmbed;
            let failedEmbed;

            if (successfulUsers.length > 0) {
                const successUsernames = successfulUsers.map(u => u.username).join(', ');
                responseMessage += `Successfully **${subcommand === 'add' ? 'added' : 'removed'}** **${amount}** points to/from the following users: **${successUsernames}**.\n`;

                if (failedUsers.length > 0) {
                    const failedUsernames = failedUsers.map(u => u.username).join(', ');
                    responseMessage += `Could not ${subcommand === 'add' ? 'add' : 'remove'} points for the following users: **${failedUsernames}**.`;
                }

                successEmbed = createSuccessEmbed(interaction.guild.name, "Points")
                    .setDescription(responseMessage);
            } else if (failedUsers.length > 0) {
                const failedUsernames = failedUsers.map(u => u.username).join(', ');
                responseMessage = `Could not ${subcommand === 'add' ? 'add' : 'remove'} points for the following users: ${failedUsernames}.`;
                failedEmbed = createFailedEmbed(interaction.guild.name, "Points")
                    .setDescription(responseMessage);
            } else {
                responseMessage = 'No valid users to process.';
            }

            // Reply with the aggregated message
            if (successEmbed) {
                await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            } else if (failedEmbed) {
                await interaction.reply({ embeds: [failedEmbed], ephemeral: true });
            } else {
                await interaction.reply(responseMessage);
            }

            // Log the operation
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const pointLoggingEmbed = createLogEmbed(interaction.guild.name, "Verify")
                    .setTitle("Points Modified")
                    .setDescription(`User <@${interaction.user.id}> performed a **${subcommand}** operation.\nSuccessful Users: **${successfulUsers.map(u => u.username).join(', ')}**\nFailed Users: **${failedUsers.map(u => u.username).join(', ')}**`);

                // Send the embed wrapped in an object
                await logChannel.send({ embeds: [pointLoggingEmbed] });
            }
        } catch (error) {
            console.error(error);
            const errorEmbed = createFailedEmbed(interaction.guild.name, "Points")
                .setDescription('An error occurred while processing your request.');
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
};

// Function to fetch Roblox ID using noblox.js
async function getRobloxId(username) {
    try {
        const robloxId = await noblox.getIdFromUsername(username);
        return robloxId;
    } catch (error) {
        console.error(`Error fetching Roblox ID for ${username}:`, error);
        return null; // Return null if the Roblox ID could not be fetched
    }
}

// Function to update points in the database
async function updatePoints(robloxId, amount, isAdding) {
    try {
        const existingUser = await pointsSchema.findOne({ robloxId });

        if (existingUser) {
            // Update existing user's points
            existingUser.points = isAdding ? existingUser.points + amount : existingUser.points - amount;
            await existingUser.save();
        } else {
            // Create a new user with initial points
            const newUser = new pointsSchema({ robloxId, points: isAdding ? amount : 0 });
            await newUser.save();
        }
    } catch (error) {
        console.error(`Error updating points for Roblox ID ${robloxId}:`, error);
    }
}
