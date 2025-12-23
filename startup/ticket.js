const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

let ticketCounter = 0; // licznik ticketów w sesji bota

module.exports = (client) => {
    const TICKET_CHANNEL_ID = '1312759128627871816';
    const ADMIN_ROLE_ID = '1436376487157694586';

    // 1️⃣ Embed startowy z select menu
    client.once(Events.ClientReady, async () => {
        try {
            const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
            if (!channel) return console.log('Nie znaleziono kanału ticketowego!');

            const embed = new EmbedBuilder()
                .setTitle('```Sprawdziany & Kartkówki | Tickety```')
                .setDescription(
                    '<:emoji1:1452712183589900298> Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię "INNE"\n' +
                    '<:emoji2:1452712355002585330> Interesuje Cię zakup? Wybierz kategorię "ZAKUPY"'
                )
                .setColor('Blue')
                .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png');

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_category')
                .setPlaceholder('Wybierz kategorię ticketa...')
                .addOptions([
                    { label: 'INNE', description: 'Problemy niezwiązane z zakupem', value: 'inne', emoji: '1452714487244132483' },
                    { label: 'ZAKUPY', description: 'Zakup sprawdzianu/kartkówki', value: 'zakupy', emoji: '1453054774172975124' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await channel.send({ embeds: [embed], components: [row] });
            console.log('✅ Embed ticketowy wysłany!');

        } catch (error) {
            console.error('Błąd przy wysyłaniu embedu ticketowego:', error);
        }
    });

    // 2️⃣ Obsługa wyboru kategorii
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'ticket_category') return;

        const user = interaction.user;
        ticketCounter += 1; // nowy numer ticketa

        let modal;
        if (interaction.values[0] === 'inne') {
            modal = new ModalBuilder()
                .setCustomId(`modal_inne_${user.id}`)
                .setTitle('INNE')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('opis_problem')
                            .setLabel('Opisz problem!')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Np. Cennik nie działa')
                            .setRequired(true)
                    )
                );
        } else if (interaction.values[0] === 'zakupy') {
            modal = new ModalBuilder()
                .setCustomId(`modal_zakupy_${user.id}`)
                .setTitle('ZAKUPY')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('produkt')
                            .setLabel('Co chcesz zakupić?')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Np. Sprawdzian/Kartkówka')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('wydawnictwo')
                            .setLabel('Wydawnictwo')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Np. Nowa Era')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('platnosc')
                            .setLabel('Czym będziesz płacił?')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Np. Blik, PaySafeCard, inne')
                            .setRequired(true)
                    )
                );
        }

        if (modal) await interaction.showModal(modal);
    });

    // 3️⃣ Obsługa modali
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isModalSubmit()) return;

        const user = interaction.user;
        ticketCounter += 0; // zachowujemy numer ticketa

        let channelName;
        let embedFields = [];
        let category;

        if (interaction.customId.startsWith('modal_inne')) {
            const opis = interaction.fields.getTextInputValue('opis_problem');
            category = 'INNE';
            channelName = `❓|${user.username}`;

            embedFields = [
                { name: '🔹 Informacje o użytkowniku', value: `> Ping: ${user}\n> TAG: ${user.tag}\n> ID: ${user.id}`, inline: false },
                { name: '📝 Opis problemu', value: `> ${opis}`, inline: false }
            ];
        } else if (interaction.customId.startsWith('modal_zakupy')) {
            const produkt = interaction.fields.getTextInputValue('produkt');
            const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
            const platnosc = interaction.fields.getTextInputValue('platnosc');
            category = 'ZAKUPY';
            channelName = `🛒|${user.username}`;

            embedFields = [
                { name: '🔹 Informacje o użytkowniku', value: `> Ping: ${user}\n> TAG: ${user.tag}\n> ID: ${user.id}`, inline: false },
                { name: '💰 Informacje o transakcji', value: `> ID Transakcji: ${ticketCounter}\n> Kategoria: ${category}\n> Produkt: ${produkt}\n> Wydawnictwo: ${wydawnictwo}\n> Metoda płatności: ${platnosc}`, inline: false }
            ];
        } else return;

        // Tworzymy kanał ticketa
        const guild = interaction.guild;
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: 0, // GUILD_TEXT
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: ['ViewChannel'] },
                { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
                { id: ADMIN_ROLE_ID, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] }
            ]
        });

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Ticket #${ticketCounter} | ${category}`)
            .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
            .setFields(embedFields)
            .setThumbnail('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png');

        // Przyciski admina
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Zamknij ticket')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('admin_panel')
                .setLabel('Panel administracyjny')
                .setStyle(ButtonStyle.Primary)
        );

        await ticketChannel.send({ embeds: [ticketEmbed], components: [buttons] });

        await interaction.reply({ content: `✅ Ticket otworzony: ${ticketChannel}`, ephemeral: true });
    });

    // 4️⃣ Obsługa przycisków administracyjnych
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID)) return;

        const channel = interaction.channel;
        if (!channel.name.startsWith('❓|') && !channel.name.startsWith('🛒|')) return;

        if (interaction.customId === 'close_ticket') {
            await channel.delete();
            await interaction.reply({ content: '✅ Ticket został zamknięty.', ephemeral: true });
        }

        if (interaction.customId === 'admin_panel') {
            // tutaj możesz dodać np. przywołanie użytkownika lub inne akcje
            await interaction.reply({ content: 'Panel admina otwarty. (Do uzupełnienia dalsze funkcje)', ephemeral: true });
        }
    });
};
