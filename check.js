const { SlashCommandBuilder } = require('discord.js');
const RobloxVerifiedAccount = require('../Schema/verificationSchema');
const pointsSchema = require('../Schema/pointSchema');
const banSchema1 = require('../Schema/banSchema');
const axios = require('axios');
const noblox = require('noblox.js');
const fs = require('fs');
const path = require('path');
const { createFailedEmbed, createSuccessEmbed } = require('../embeds/statusEmbed');

// Load group configuration from JSON file
const groupConfigPath = path.join(__dirname, '../config/groups.json');
const groupConfig = JSON.parse(fs.readFileSync(groupConfigPath, 'utf8'));

// Function to get user groups
async function getUserGroups(robloxId) {
    try {
        const response = await axios.get(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching user groups:', error.message);
        throw new Error('Unable to fetch user groups');
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('check')
        .setDescription('Displays user information')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Roblox username to check')
                .setRequired(false)),
    async execute(interaction) {
        const username = interaction.options.getString('username');
        const discordId = interaction.user.id;

        if (username) {
            try {
                let robloxId;
                try {
                    robloxId = await noblox.getIdFromUsername(username);
                } catch (error) {
                    const errorEmbed = createFailedEmbed(interaction.guild.name, 'Check')
                        .setDescription('User does not exist.');
                    return await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }

                const userPoints = await pointsSchema.findOne({ robloxId }).exec();
                const userBan = await banSchema1.findOne({ robloxId }).exec();
                const groups = await getUserGroups(robloxId);
                const thumbnails = await noblox.getPlayerThumbnail([robloxId], "720x720", "png", false, "body");

                const pointsValue = userPoints ? `${userPoints.points}` : '-';

const banExpirationTimestamp = userBan
    ? `<t:${Math.floor((userBan.createdAt.getTime() + (userBan.durationInMin * 60 * 1000)) / 1000)}:f>` 
    : '-';

const banReason = userBan ? userBan.reason || 'No reason provided' : '-';
const gameBanField = userBan 
    ? `${banExpirationTimestamp}, Reason: ${banReason}` 
    : '-';

const groupFields = groups && groups.length > 0 
    ? groups.map(groupInfo => {
        const groupId = groupInfo.group.id;
        const roleName = groupInfo.role.name;
        return groupConfig[groupId] 
            ? { name: groupConfig[groupId].groupName, value: roleName, inline: true } 
            : null;
    }).filter(Boolean) 
    : [{ name: 'Group Membership', value: '-', inline: false }];

const userProfileUrl = `https://roblox.com/users/${robloxId}/profile`;

const successEmbed = createSuccessEmbed(interaction.guild.name, 'Check')
    .setDescription(`Information about user:\n\n**User**\n[${username} (${robloxId})](${userProfileUrl})`)
    .addFields(
        { name: 'Points', value: pointsValue, inline: true },
        { name: 'Game Ban', value: gameBanField, inline: true }
    )
                    .addFields(
                        { name: 'Group Membership', value: groupFields.length > 0 ? '\u200B' : 'No groups found.', inline: false },
                        ...groupFields
                    )
                    .setTimestamp()
                    .setThumbnail(thumbnails[0].imageUrl)

                await interaction.reply({ embeds: [successEmbed] });
            } catch (error) {
                console.error('Error processing request:', error.message);
                const errorEmbed = createFailedEmbed(interaction.guild.name, 'Check')
                    .setDescription('There was an error processing your request.');
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        } else {
            try {
                const userRecord = await RobloxVerifiedAccount.findOne({ discordId }).exec();
                if (!userRecord) {
                    const noAccountEmbed = createFailedEmbed(interaction.guild.name, 'Check')
                        .setDescription('No associated Roblox account found for your Discord account.');
                    return await interaction.reply({ embeds: [noAccountEmbed], ephemeral: true });
                }

                const robloxId = userRecord.robloxId;
                const userPoints = await pointsSchema.findOne({ robloxId }).exec();
                const userBan = await banSchema1.findOne({ robloxId }).exec();
                const groups  = await getUserGroups(robloxId);
                const thumbnails = await noblox.getPlayerThumbnail([robloxId], "720x720", "png", false, "body");

                const pointsValue = userPoints ? `${userPoints.points}` : '-';

const banExpirationTimestamp = userBan
    ? `<t:${Math.floor((userBan.createdAt.getTime() + (userBan.durationInMin * 60 * 1000)) / 1000)}:f>` 
    : '-';

const banReason = userBan ? userBan.reason || 'No reason provided' : '-';
const gameBanField = userBan 
    ? `Expires: ${banExpirationTimestamp}, Reason: **${banReason}**` 
    : '-';

const groupFields = groups && groups.length > 0 
    ? groups.map(groupInfo => {
        const groupId = groupInfo.group.id;
        const roleName = groupInfo.role.name;
        return groupConfig[groupId] 
            ? { name: groupConfig[groupId].groupName, value: roleName, inline: true } 
            : null;
    }).filter(Boolean) 
    : [{ name: 'Group Membership', value: '-', inline: false }];

const userProfileUrl = `https://roblox.com/users/${robloxId}/profile`;

const successEmbed = createSuccessEmbed(interaction.guild.name, 'Check')
    .setDescription(`Information about user:\n\n**User**\n[${userRecord.robloxUsername} (${robloxId})](${userProfileUrl})`)
    .addFields(
        { name: 'Points', value: pointsValue, inline: true },
        { name: 'Game Ban', value: gameBanField, inline: true }
    )
                    .addFields(
                        { name: 'Group Membership', value: groupFields.length > 0 ? '\u200B' : 'No groups found.', inline: false },
                        ...groupFields
                    )
                    .setTimestamp()
                    .setThumbnail(thumbnails[0].imageUrl)

                await interaction.reply({ embeds: [successEmbed] });
            } catch (error) {
                console.error('Error processing request:', error.message);
                const errorEmbed = createFailedEmbed(interaction.guild.name, 'Check')
                    .setDescription('There was an error processing your request.');
                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }
        }
    }
};
