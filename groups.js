const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios'); // Import axios for making HTTP requests
const path = require('path');
const fs = require('fs');
const { createFailedEmbed, createLogEmbed, createSuccessEmbed } = require('../embeds/statusEmbed');

const makeChannelRoleIdPath = path.join(__dirname, '../Config/makeChannelRoleId.json');

function hasPermission(member) {
    const config = JSON.parse(fs.readFileSync(makeChannelRoleIdPath, 'utf8'));
    const banIds = config.RoleId.ownerId;
    return banIds.some(roleId => member.roles.cache.has(roleId));
}
const groupsFilePath = path.join(__dirname, '../config/groups.json'); // Path to the JSON file

module.exports = {
    data: new SlashCommandBuilder()
        .setName('group')  // Command name
        .setDescription('Manage groups.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('Displays all groups.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Adds a group by ID.')
                .addStringOption(option =>
                    option
                        .setName('groupid')
                        .setDescription('The ID of the group to add')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Removes a group by ID.')
                .addStringOption(option =>
                    option
                        .setName('groupid')
                        .setDescription('The ID of the group to remove')
                        .setRequired(true))),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (!hasPermission(interaction.member)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }
        switch (subcommand) {
            case 'view':
                // Handle the view subcommand
                try {
                    if (fs.existsSync(groupsFilePath)) {
                        const fileData = fs.readFileSync(groupsFilePath, 'utf8');
                        const groupsJson = JSON.parse(fileData);

                        const groupEntries = Object.entries(groupsJson);
                        if (groupEntries.length === 0) {
                            const errorAddGroupEmbed2 = createFailedEmbed(interaction.guild.name, 'Group')
                            .setDescription(`No groups found in the JSON file.`);
                             await interaction.reply({ embeds: [errorAddGroupEmbed2], ephemeral: true });
                        } else {
                            const groupList = groupEntries.map(([id, data]) => `**ID**: ${id}, **Name**: ${data.groupName}`).join('\n');
                            const viewGroupEmbed = createSuccessEmbed(interaction.guild.name, 'Group')
                            .setTitle('Current Groups Saved')
                            .setDescription(`Current groups:\n${groupList}`);
                            return await interaction.reply({ embeds: [viewGroupEmbed], ephemeral: true });

                        }
                    } else {
                        await interaction.reply({ content: 'Groups file does not exist.', ephemeral: true });

                    }
                } catch (error) {
                    console.error('Error:', error);
                    const errorAddGroupEmbed = createFailedEmbed(interaction.guild.name, 'Group')
                    .setDescription(`Failed to read groups data.`);
                     await interaction.reply({ embeds: [errorAddGroupEmbed], ephemeral: true });

                }
                break;

                case 'add':
                    const addGroupId = interaction.options.getString('groupid');
                
                    try {
                        // Check if the group ID is already in the JSON file
                        let groupsJson = {};
                        if (fs.existsSync(groupsFilePath)) {
                            const fileData = fs.readFileSync(groupsFilePath, 'utf8');
                            groupsJson = JSON.parse(fileData);
                        }
                
                        if (groupsJson[addGroupId]) {
                            const addGroupExistEmbed = createFailedEmbed(interaction.guild.name, 'Group')
                            .setDescription(`Group with ID ${addGroupId} already exists.`);
                             await interaction.reply({ embeds: [addGroupExistEmbed], ephemeral: true });
                            return; // Exit the function early
                        }
                
                        // Fetch group data from the API
                        const response = await axios.get(`https://groups.roblox.com/v1/groups/${addGroupId}`);
                        const groupData = response.data;
                        const groupName = groupData.name;
                
                        // Add the new group to the JSON object
                        groupsJson[addGroupId] = {
                            groupName: groupName
                        };
                        fs.writeFileSync(groupsFilePath, JSON.stringify(groupsJson, null, 2), 'utf8');
                
                        const addGroupEmbed = createSuccessEmbed(interaction.guild.name, 'Group')
                        .setTitle('Group Saved')
                        .setDescription(`Group with ID ${addGroupId} has been added. Check the config file for details.`);
                        return await interaction.reply({ embeds: [addGroupEmbed], ephemeral: true });
                    } catch (error) {
                        console.error('Error:', error);
                        await interaction.reply({ content: `Failed to fetch data for group ID ${addGroupId}.`, ephemeral: true });

                    }
                    break;

            case 'remove':
                const removeGroupId = interaction.options.getString('groupid');

                try {
                    if (fs.existsSync(groupsFilePath)) {
                        const fileData = fs.readFileSync(groupsFilePath, 'utf8');
                        let groupsJson = JSON.parse(fileData);

                        if (groupsJson[removeGroupId]) {
                            const removedGroupEmbed = createSuccessEmbed(interaction.guild.name, 'Group')
                            .setTitle('Group Removed')
                            .setDescription(`Group with ID ${removeGroupId} has been removed.`);
                             await interaction.reply({ embeds: [removedGroupEmbed], ephemeral: true });
                            delete groupsJson[removeGroupId]; // Remove the group from the JSON object

                            fs.writeFileSync(groupsFilePath, JSON.stringify(groupsJson, null, 2), 'utf8');
                            

                        } else {
                            const removedGroupNotExistEmbed = createFailedEmbed(interaction.guild.name, 'Group')
                            .setDescription(`Group with ID ${removeGroupId} does not exist.`);
                             await interaction.reply({ embeds: [removedGroupNotExistEmbed], ephemeral: true });
                        }
                    } else {
                        const removedGroupNotExist1Embed = createFailedEmbed(interaction.guild.name, 'Group')
                        .setDescription(`Group with ID ${removeGroupId} does not exist.`);
                         await interaction.reply({ embeds: [removedGroupNotExist1Embed], ephemeral: true });
                    }
                } catch (error) {
                    console.error('Error:', error);
                    const errorOccuredEmbed = createFailedEmbed(interaction.guild.name, 'Group')
                            .setDescription(`Failed to read or update groups data.`);
                             await interaction.reply({ embeds: [errorOccuredEmbed], ephemeral: true });

                }
                break;

            default:
                const errorOccuredEmbed1 = createFailedEmbed(interaction.guild.name, 'Group')
                .setDescription(`An error occurred while processing the command.`);
                 await interaction.reply({ embeds: [errorOccuredEmbed1], ephemeral: true });

                break;
        }
    }
};
