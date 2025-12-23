const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

module.exports = (client) => {
    client.once(Events.ClientReady, async () => {
        const verificationChannelId = '1313035660709593160';

        try {
            const verificationChannel = await client.channels.fetch(verificationChannelId);
            if (!verificationChannel) return console.log('Nie znaleziono kanału weryfikacji!');

            // Embed z dużym obrazkiem
            const embed = new EmbedBuilder()
                .setTitle('🔒 Weryfikacja konta')
                .setDescription('Kliknij poniższy przycisk, aby zweryfikować i uzyskać dostęp do serwera.')
                .setColor('Blue')
                .setImage('https://cdn.discordapp.com/attachments/1313035660709593160/1452946476513759302/file_00000000671c71f4ba93b970114f47d5.png')
                .setFooter({ text: 'Sprawdziany & Kartkówki • Weryfikacja', iconURL: verificationChannel.guild.iconURL({ dynamic: true }) });

            // Przycisk linkowy
            const button = new ButtonBuilder()
                .setLabel('Kliknij tutaj, aby uzyskać Dostęp do Sprawdzianów I Kartkówek')
                .setStyle(ButtonStyle.Link)
                .setURL('https://restorecord.com/verify/Verify%20%E2%9C%85%20Sprawdziany%20%26%20Kartk%C3%B3wki%F0%9F%93%9D');

            const row = new ActionRowBuilder().addComponents(button);

            await verificationChannel.send({ embeds: [embed], components: [row] });

            console.log('✅ Wiadomość weryfikacyjna wysłana!');
        } catch (error) {
            console.error('Błąd przy wysyłaniu wiadomości weryfikacyjnej:', error);
        }
    });
};
