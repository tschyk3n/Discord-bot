const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const BindingSchemaLog = require('../Schema/bindingSchema');
const { createFailedEmbed, createSuccessEmbed, createPendingEmbed } = require('../embeds/statusEmbed');
const { isConfigComplete } = require('../handlers/configHandler');

// Make sure this is a string path to your config file
const makeChannelRoleIdPath = path.join(__dirname, '../Config/makeChannelRoleId.json');

const ITEMS_PER_PAGE = 8;

function isOwner(member) {
    const config = JSON.parse(fs.readFileSync(makeChannelRoleIdPath, 'utf8'));
    const ownerIds = config.RoleId.ownerId;
    return ownerIds.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bind')
        .setDescription('Add, View, Remove, or Update binding.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View a binding by group ID')
                .addStringOption(option =>
                    option
                        .setName('groupid')
                        .setDescription('The ID of the group to view')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a binding for Roblox roles and Discord roles')
                .addStringOption(option =>
                    option
                        .setName('groupid')
                        .setDescription('The ID of the group to bind roles to')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('roleid')
                        .setDescription('The Roblox role ID to bind')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('discordroleids')
                        .setDescription('The Discord role IDs to bind (comma-separated)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove bindings by group ID')
                .addStringOption(option =>
                    option
                        .setName('groupid')
                        .setDescription('The ID of the group to unbind roles from')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('discordroleids')
                        .setDescription('The Discord role IDs to remove (comma-separated)')
                )
        ),

    async execute(interaction) {
        const member = interaction.member;

        if (!isOwner(member)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        if (!isConfigComplete()) {
            return interaction.reply({
                content: 'The configuration is not complete. Please fill all required fields. Please use /setup.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const groupId = interaction.options.getString('groupid');
            const serverId = interaction.guild.id;

            // Send a pending embed while fetching data
            const pendingEmbed = createPendingEmbed(interaction.guild.name, 'Bind View');
            await interaction.reply({ embeds: [pendingEmbed], ephemeral: true });

            try {
                // Fetch roles from Roblox API
                const response = await axios.get(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
                const roles = response.data.roles;

                // Sort roles by rank
                roles.sort((a, b) => a.rank - b.rank);

                // Retrieve bindings from the database
                const bindings = await BindingSchemaLog.find({ groupId, serverId }).exec();
                const boundRobloxRanks = bindings.map(binding => binding.robloxRankId);
                const boundDiscordRoles = bindings.flatMap(binding => ({
                    robloxRoleId: binding.robloxRankId,
                    discordRoles: binding.discordRoleIds
                }));

                // Generate pages of roles
                const pages = [];
                for (let i = 0; i < roles.length; i += ITEMS_PER_PAGE) {
                    const pageRoles = roles.slice(i, i + ITEMS_PER_PAGE);
                    const description = pageRoles.map(role => {
                        const binding = boundDiscordRoles.find(b => b.robloxRoleId === role.id.toString());
                        const discordRolesList = binding ? binding.discordRoles.map(dId => `<@&${dId}>`).join(', ') : 'None';
                        return `**${role.name}** (ID: ${role.id}) - Bound Discord Roles: ${discordRolesList}`;
                    }).join('\n');

                    const embed = createSuccessEmbed(interaction.guild.name, `Roles for group ID ${groupId}`)
                        .setDescription(description);
                    pages.push(embed);
                }

                // If there's only one page, no need for buttons
                if (pages.length === 1) {
                    await interaction.editReply({ embeds: [pages[0]], components: [] });
                } else {
                    // Create buttons for pagination
                    const row = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back')
                                .setLabel('Back')
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(true),
                            new ButtonBuilder()
                                .setCustomId('next')
                                .setLabel('Next')
                                .setStyle(ButtonStyle.Primary)
                        );

                    // Send the initial page with buttons
                    const reply = await interaction.editReply({
                        embeds: [pages[0]],
                        components: [row],
                        fetchReply: true
                    });
                    const filter = i => ['next', 'back'].includes(i.customId) && i.user.id === interaction.user.id;
                    const collector = reply.createMessageComponentCollector({ filter, time: 60000 });
                    
                    let currentPage = 0;
                    
                    collector.on('collect', async i => {
                        try {
                            if (i.customId === 'next') {
                                currentPage++;
                            } else if (i.customId === 'back') {
                                currentPage--;
                            }
                    
                            // Update the embed and buttons
                            await i.update({
                                embeds: [pages[currentPage]],
                                components: [
                                    new ActionRowBuilder()
                                        .addComponents(
                                            new ButtonBuilder()
                                                .setCustomId('back')
                                                .setLabel('Back')
                                                .setStyle(ButtonStyle.Primary)
                                                .setDisabled(currentPage === 0),
                                            new ButtonBuilder()
                                                .setCustomId('next')
                                                .setLabel('Next')
                                                .setStyle(ButtonStyle.Primary)
                                                .setDisabled(currentPage === pages.length - 1)
                                        )
                                ]
                            });
                        } catch (error) {
                            if (error.code === 10008) {
                                console.error('Message was deleted or no longer exists');
                            } else {
                                console.error('Error updating message:', error);
                            }
                        }
                    });
                    
                    collector.on('end', async collected => {
                        try {
                            // Disable buttons after the collector ends
                            await reply.edit({
                                components: [
                                    new ActionRowBuilder()
                                        .addComponents(
                                            new ButtonBuilder()
                                                .setCustomId('back')
                                                .setLabel('Back')
                                                .setStyle(ButtonStyle.Primary)
                                                .setDisabled(true),
                                            new ButtonBuilder()
                                                .setCustomId('next')
                                                .setLabel('Next')
                                                .setStyle(ButtonStyle.Primary)
                                                .setDisabled(true)
                                        )
                                ]
                            });
                        } catch (error) {
                            if (error.code === 10008) {
                                console.error('Message was deleted or no longer exists');
                            } else {
                                console.error('Error editing message after collector ended:', error);
                            }
                        }
                    });
                  
                }
            } catch (error) {
                console.error('Error fetching group roles:', error);
                const failedEmbed = createFailedEmbed(interaction.guild.name, 'Bind View');
                await interaction.editReply({ embeds: [failedEmbed], components: [] });
            }
        } else if (subcommand === 'add') {
            const groupId = interaction.options.getString('groupid');
            const serverId = interaction.guild.id;
            const robloxRoleId = interaction.options.getString('roleid');
            const discordRoleIdsInput = interaction.options.getString('discordroleids');
            const discordRoleIds = discordRoleIdsInput.split(',').map(roleId => roleId.trim());

            try {
                // Check if the binding already exists
                const existingBinding = await BindingSchemaLog.findOne({ groupId, serverId, robloxRankId: robloxRoleId });

                if (existingBinding) {
                    // If a binding exists, update it with the new Discord roles
                    existingBinding.discordRoleIds = [...new Set([...existingBinding.discordRoleIds, ...discordRoleIds])];
                    await existingBinding.save();
                } else {
                    // Create a new binding
                    const newBinding = new BindingSchemaLog({
                        groupId,
                        serverId,
                        discordRoleIds,
                        robloxRankId: robloxRoleId
                    });
                    await newBinding.save();
                }

                const successEmbed = createSuccessEmbed(interaction.guild.name, 'Bind Add')
                    .setDescription(`Successfully bound Discord roles ${discordRoleIds.map(id => `<@&${id}>`).join(', ')} to Roblox role ID ${robloxRoleId}.`);
                
                await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            } catch (error) {
                console.error('Error adding binding:', error);
                const failedEmbed = createFailedEmbed(interaction.guild.name, 'Bind Add')
                    .setDescription('An error occurred while trying to add the binding.');
                await interaction.reply({ embeds: [failedEmbed], ephemeral: true });
            }
        } else if (subcommand === 'remove') {
            const groupId = interaction.options.getString('groupid');
            const serverId = interaction.guild.id;
            const discordRoleIdsInput = interaction.options.getString('discordroleids');
            const discordRoleIds = discordRoleIdsInput ? discordRoleIdsInput.split(',').map(roleId => roleId.trim()) : null;
        
            try {
                if (discordRoleIds) {
                    // Remove specific Discord role bindings for the given groupId
                    // Update bindings by pulling out the specific Discord roles
                    const result = await BindingSchemaLog.updateMany(
                        { groupId, serverId },
                        { $pull: { discordRoleIds: { $in: discordRoleIds } } }
                    );
        
                    // Remove bindings where no Discord roles remain
                    await BindingSchemaLog.deleteMany({ groupId, serverId, discordRoleIds: { $size: 0 } });
        
                    const successEmbed = createSuccessEmbed(interaction.guild.name, 'Bind Remove')
                        .setDescription(`Successfully removed Discord roles ${discordRoleIds.map(id => `<@&${id}>`).join(', ')} from group ID ${groupId}.`);
                    
                    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
                } else {
                    // Remove all bindings for the given groupId
                    await BindingSchemaLog.deleteMany({ groupId, serverId });
        
                    const successEmbed = createSuccessEmbed(interaction.guild.name, 'Bind Remove')
                        .setDescription(`Successfully removed all bindings for group ID ${groupId}.`);
        
                    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
                }
            } catch (error) {
                console.error('Error removing binding:', error);
                const failedEmbed = createFailedEmbed(interaction.guild.name, 'Bind Remove')
                    .setDescription('An error occurred while trying to remove the binding.');
                await interaction.reply({ embeds: [failedEmbed], ephemeral: true });
            }
        }
    }
};
