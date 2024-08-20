const { SlashCommandBuilder } = require('discord.js');
const noblox = require('noblox.js');
const { createFailedEmbed, createSuccessEmbed, createPendingEmbed, createLogEmbed } = require('../embeds/statusEmbed');
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
        .setName('unban')
        .setDescription('Unban a user from Roblox.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('roblox')
                .setDescription('unban a Roblox user')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('The username of the Roblox user')
                        .setRequired(true))
                ),
    
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
       

        try {
            const robloxId = await noblox.getIdFromUsername(username);
            const existingBan = await isUserAlreadyBanned(robloxId);
            if (!existingBan) {
                await interaction.reply({
                    content: 'This user is not banned.',
                    ephemeral: true
                });
                return;
            }

            const successfulUnbannedEmbed = createSuccessEmbed(interaction.guild.name, "Unban")
            .setDescription(`You have Unbanned **${username}**.`)

             await interaction.reply({ embeds: [successfulUnbannedEmbed], components: [], ephemeral: true});


             await banSchema1.findOneAndDelete({ robloxId: robloxId });
            // Start the server and send data
            startServer({ robloxId, action: "Unban" });

            const banLogChannel = makeChannelRoleId.ChannelId.logChannel;
            const logChannel = interaction.guild.channels.cache.get(banLogChannel);
            if (logChannel) {
                const banLoggingEmbed = createLogEmbed(interaction.guild.name, "Unban")
                    .setTitle("User Unbanned")
                    .setDescription(`<@${interaction.user.id}> has unbanned Roblox user **${username}**.`);

                await logChannel.send({ embeds: [banLoggingEmbed] });
            }
        } catch (error) {
            console.error('Error executing the unban command:', error);
            await interaction.reply({
                embeds: [createFailedEmbed(interaction.guild.name, 'Failed to unban the user')],
                ephemeral: true
            });
        }
    }
};