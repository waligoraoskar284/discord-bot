const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

module.exports = (client) => {
    client.on(Events.ClientReady, async () => {
        const verificationChannelId = '1313035660709593160';

        try {
            const channel = await client.channels.fetch(verificationChannelId);
            if (!channel) return console.log('Nie znaleziono kanału weryfikacji!');

            const embed = new EmbedBuilder()
               .setTitle(' ')
.setDescription(
    '# 🔒 WERYFIKACJA KONTA\n\n' +
                    '\nKliknij poniższy przycisk, aby uzyskać dostęp do sprawdzianów i kartkówek.'
                )
                .setColor('Blue')
                .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png')
                .setFooter({
                    text: 'Sprawdziany & Kartkówki • Weryfikacja',
                    iconURL: channel.guild.iconURL({ dynamic: true })
                });

            const button = new ButtonBuilder()
                .setLabel('Kliknij tutaj, aby uzyskać Dostęp do Sprawdzianów I Kartkówek')
                .setStyle(ButtonStyle.Link)
                .setURL('https://restorecord.com/verify/Verify%20%E2%9C%85%20Sprawdziany%20%26%20Kartk%C3%B3wki%F0%9F%93%9D');

            const row = new ActionRowBuilder().addComponents(button);

            await channel.send({ embeds: [embed], components: [row] });

            console.log('✅ Wiadomość weryfikacyjna wysłana!');
        } catch (error) {
            console.error('Błąd przy wysyłaniu wiadomości weryfikacyjnej:', error);
        }
    });
};
