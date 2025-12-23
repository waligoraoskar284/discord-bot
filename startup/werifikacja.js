const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

// Ścieżka do pliku JSON
const sentFile = path.join(__dirname, 'werifikacjaSent.json');

// Funkcja do sprawdzenia, czy wiadomość została wysłana
function hasBeenSent() {
    if (!fs.existsSync(sentFile)) return false;
    try {
        const data = fs.readFileSync(sentFile, 'utf-8');
        return JSON.parse(data).sent;
    } catch {
        return false;
    }
}

// Funkcja oznaczająca, że wiadomość została wysłana
function markAsSent() {
    fs.writeFileSync(sentFile, JSON.stringify({ sent: true }));
}

module.exports = (client) => {
    client.once(Events.ClientReady, async () => {
        if (hasBeenSent()) return; // jeśli już wysłano, nic nie robimy

        const verificationChannelId = '1313035660709593160';

        try {
            const channel = await client.channels.fetch(verificationChannelId);
            if (!channel) return console.log('Nie znaleziono kanału weryfikacji!');

            const embed = new EmbedBuilder()
                .setTitle('🔒 WERYFIKACJA KONTA')
                .setDescription('**❗Kliknij poniższy przycisk, aby uzyskać dostęp do sprawdzianów i kartkówek.**')
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
            markAsSent(); // zapisujemy stan w JSON

        } catch (error) {
            console.error('Błąd przy wysyłaniu wiadomości weryfikacyjnej:', error);
        }
    });
};
