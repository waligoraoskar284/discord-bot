const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');

// Plik do zapisu, czy wiadomość została wysłana
const sentFile = path.join(__dirname, 'verifySent.json');

// Sprawdzenie, czy wiadomość została już wysłana
function hasBeenSent() {
    if (!fs.existsSync(sentFile)) return false;
    try {
        const data = fs.readFileSync(sentFile, 'utf-8');
        return JSON.parse(data).sent;
    } catch {
        return false;
    }
}

// Zaznaczenie, że wiadomość została wysłana
function markAsSent() {
    fs.writeFileSync(sentFile, JSON.stringify({ sent: true }));
}

// Eksportujemy funkcję, która przyjmuje klienta z index.js
module.exports = (client) => {
    if (hasBeenSent()) return; // jeśli już wysłano, nic nie robimy

    client.once(Events.ClientReady, async () => {
        const verificationChannelId = '1313035660709593160';
        const logChannelId = '1452604416216793119';
        const roleId = '1312763974718193735';

        try {
            const verificationChannel = await client.channels.fetch(verificationChannelId);
            if (!verificationChannel) return console.log('Nie znaleziono kanału weryfikacji!');

            const button = new ButtonBuilder()
                .setCustomId('verify_button')
                .setLabel('Zweryfikuj się')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);

            await verificationChannel.send({
                content: 'Kliknij przycisk aby zweryfikować swoje konto!',
                components: [row],
            });

            console.log('✅ Wiadomość weryfikacyjna wysłana!');
            markAsSent();

            const logChannel = await client.channels.fetch(logChannelId);
            if (logChannel) logChannel.send('✅ Wiadomość weryfikacyjna została wysłana.');
        } catch (error) {
            console.error('Błąd przy wysyłaniu wiadomości weryfikacyjnej:', error);
        }
    });

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;
        if (interaction.customId !== 'verify_button') return;

        const member = interaction.member;
        if (!member.roles.cache.has(roleId)) {
            try {
                await member.roles.add(roleId);
                await interaction.reply({ content: '✅ Zostałeś zweryfikowany!', ephemeral: true });

                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) logChannel.send(`✅ Użytkownik ${member.user.tag} został zweryfikowany.`);
            } catch (error) {
                console.error('Błąd przy weryfikacji użytkownika:', error);
                await interaction.reply({ content: '❌ Wystąpił błąd przy weryfikacji.', ephemeral: true });
            }
        } else {
            await interaction.reply({ content: '❌ Jesteś już zweryfikowany!', ephemeral: true });
        }
    });
};
