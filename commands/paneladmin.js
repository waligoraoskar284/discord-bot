const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('paneladmin')
        .setDescription('Panel administratora'),

    async execute(interaction) {
        // Sprawdzenie, czy użytkownik ma odpowiednią rolę
        const adminRoleId = '1436376487157694586';
        if (!interaction.member.roles.cache.has(adminRoleId)) {
            return interaction.reply({ content: 'Nie masz uprawnień do użycia tej komendy.', ephemeral: true });
        }

        const guild = interaction.guild;

        // Liczba członków na serwerze
        const totalMembers = guild.memberCount;

        // Liczba osób z konkretną rolą
        const targetRoleId = '1399469528240492634';
        const role = guild.roles.cache.get(targetRoleId);

        const membersWithRole = role ? role.members.size : 0;

        // Embed z informacjami
        const embed = new EmbedBuilder()
            .setTitle('Panel Administratora')
            .setColor('Blue')
            .addFields(
                { name: 'Całkowita liczba członków', value: `${totalMembers}`, inline: true },
                { name: `Liczba osób z rolą ${role ? role.name : 'Nie znaleziono roli'}`, value: `${membersWithRole}`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
