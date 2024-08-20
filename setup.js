const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { createSuccessEmbed, createFailedEmbed } = require('../embeds/statusEmbed');
const makeChannelRoleIdPath = path.join(__dirname, '../config/makeChannelRoleId.json');

// Helper function to check if a user is an owner
function isOwner(member) {
    const config = JSON.parse(fs.readFileSync(makeChannelRoleIdPath, 'utf8'));
    const ownerIds = config.RoleId.ownerId;
    return ownerIds.some(roleId => member.roles.cache.has(roleId));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Setup command for managing roles and channels.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the current channel and role configuration.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a channel or role ID.')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('The type of ID to add (channel or role).')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Log Channel', value: 'logChannel' },
                            { name: 'Verification Log', value: 'verificationLog' },
                            { name: 'Verified Role', value: 'verifiedRoleId' },
                            { name: 'Ban Permission Role', value: 'BanPermId' },
                            { name: 'Points Permission Role', value: 'PointsId' }
                        ))
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('The ID of the channel or role.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a channel or role ID.')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('The type of ID to remove (channel or role).')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Log Channel', value: 'logChannel' },
                            { name: 'Verification Log', value: 'verificationLog' },
                            { name: 'Verified Role', value: 'verifiedRoleId' },
                            { name: 'Ban Permission Role', value: 'BanPermId' },
                            { name: 'Points Permission Role', value: 'PointsId' }
                        ))
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('The ID of the channel or role to remove.')
                        .setRequired(true))),
    
    async execute(interaction) {
        try {
            const member = interaction.member;
            
            // Ensure only users with owner role can use this command
            if (!isOwner(member)) {
                await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
                return;
            }

            const subcommand = interaction.options.getSubcommand();
            const config = JSON.parse(fs.readFileSync(makeChannelRoleIdPath, 'utf8'));
            
            if (subcommand === 'view') {
                // Create a message displaying the current configuration
                const logChannel = config.ChannelId.logChannel || 'Not Set';
                const verificationLog = config.ChannelId.verificationLog || 'Not Set';
                const verifiedRoleId = config.RoleId.verifiedRoleId.length ? config.RoleId.verifiedRoleId.map(id => `<@&${id}>`).join(', ') : 'Not Set';
                const BanPermId = config.RoleId.BanPermId.length ? config.RoleId.BanPermId.map(id => `<@&${id}>`).join(', ') : 'Not Set';
                const PointsId = config.RoleId.PointsId.length ? config.RoleId.PointsId.map(id => `<@&${id}>`).join(', ') : 'Not Set';
                const ownerId = config.RoleId.ownerId.map(id => `<@&${id}>`).join(', ');

                const embed = {
                    color: 0xf7316,
                    title: 'Current Configuration',
                    fields: [
                        { name: 'Log Channel', value: `<#${logChannel}>`, inline: true },
                        { name: 'Verification Log', value: `<#${verificationLog}>`, inline: true },
                        { name: 'Verified Role', value: verifiedRoleId, inline: true },
                        { name: 'Ban Permission Role', value: BanPermId, inline: true },
                        { name: 'Points Permission Role', value: PointsId, inline: true },
                        { name: 'Owner Role', value: ownerId, inline: true },
                    ],
                    timestamp: new Date(),
                };

                await interaction.reply({ embeds: [embed], ephemeral: true });

            } else if (subcommand === 'add') {
                const type = interaction.options.getString('type');
                const id = interaction.options.getString('id');

                // Add the ID to the appropriate place in the config
                if (type === 'logChannel' || type === 'verificationLog') {
                    config.ChannelId[type] = id;
                } else {
                    config.RoleId[type].push(id);
                }

                // Save the updated configuration
                fs.writeFileSync(makeChannelRoleIdPath, JSON.stringify(config, null, 2));

                await interaction.reply({ content: 'ID successfully added.', ephemeral: true });

            } else if (subcommand === 'remove') {
                const type = interaction.options.getString('type');
                const id = interaction.options.getString('id');

                // Remove the ID from the appropriate place in the config
                if (type === 'logChannel' || type === 'verificationLog') {
                    config.ChannelId[type] = '';
                } else {
                    const index = config.RoleId[type].indexOf(id);
                    if (index > -1) {
                        config.RoleId[type].splice(index, 1);
                    }
                }

                // Save the updated configuration
                fs.writeFileSync(makeChannelRoleIdPath, JSON.stringify(config, null, 2));

                await interaction.reply({ content: 'ID successfully removed.', ephemeral: true });
            }

        } catch (error) {
            console.error('Error executing the setup command:', error);
            await interaction.reply({ embeds: [createFailedEmbed(interaction.guild.name, 'Setup')], ephemeral: true });
        }
    }
};

