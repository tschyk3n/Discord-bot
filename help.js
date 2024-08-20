const { SlashCommandBuilder } = require('discord.js');
const { createSuccessEmbed, createFailedEmbed } = require('../embeds/statusEmbed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')  // Command name
        .setDescription('Displays a list of available commands.'),
    
    async execute(interaction) {
        try {
            const commands = interaction.client.commands;
            const commandList = Array.from(commands.values())
                .map(command => ({
                    name: command.data.name.toUpperCase(),  // Convert name to uppercase
                    description: command.data.description
                }))
                .sort((a, b) => a.name.localeCompare(b.name)); // Sort commands by name
            
            // Create a description string for the embed
            const description = commandList.map(cmd => `**${cmd.name}**: ${cmd.description}`).join('\n');

            // Create and send the success embed
            const embed = createSuccessEmbed(interaction.guild.name, 'Help')
                .setTitle('Available Commands')
                .setDescription(description);

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error executing the help command:', error);
            await interaction.reply({ 
                embeds: [createFailedEmbed(interaction.guild.name, 'Help')],
                ephemeral: true
            });
        }
    }
};
