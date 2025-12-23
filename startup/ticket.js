const { 
    EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, 
    ButtonBuilder, ButtonStyle, Events 
} = require('discord.js');

let ticketCounter = 0; // licznik ticketów w sesji bota

module.exports = (client) => {
    const TICKET_CHANNEL_ID = '1312759128627871816';
    const ADMIN_ROLE_ID = '1436376487157694586';

    client.once(Events.ClientReady, async () => {
        try {
            const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
            if (!channel) return console.log('Nie znaleziono kanału ticketowego!');

            // Embed z wyborem kategorii
            const embed = new EmbedBuilder()
                .setTitle('```💡 Wybierz kategorię```')
                .setDescription(
                    '<:inne:1452715580456042647> Potrzebujesz pomocy lub kontaktu innego niż zakup? Wybierz kategorię **INNE**\n' +
                    '<:zakupy:1453054774172975124> Interesuje Cię zakup? Wybierz kategorię **ZAKUPY**'
                )
                .setColor('Blue')
                .setImage('https://cdn.discordapp.com/attachments/1312840154070777889/1453012826334695455/logo_spr.png');

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_category')
                .setPlaceholder('💡 Wybierz kategorię ticketa...')
                .addOptions([
                    { label: 'INNE', description: 'Problemy niezwiązane z zakupem', value: 'inne', emoji: { id: '1452715580456042647' } },
                    { label: 'ZAKUPY', description: 'Zakup sprawdzianu/kartkówki', value: 'zakupy', emoji: { id: '1453054774172975124' } }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await channel.send({ embeds: [embed], components: [row] });
            console.log('✅ Embed ticketowy wysłany!');

        } catch (error) {
            console.error('Błąd przy wysyłaniu embedu ticketowego:', error);
        }
    });

    // Wybór kategorii -> pokazanie modala
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'ticket_category') return;

        const user = interaction.user;
        ticketCounter += 1;

        let modal;
        if (interaction.values[0] === 'inne') {
            modal = new ModalBuilder()
                .setCustomId(`modal_inne_${user.id}_${ticketCounter}`)
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
                .setCustomId(`modal_zakupy_${user.id}_${ticketCounter}`)
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

    // Obsługa modal submit -> tworzenie ticketa
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isModalSubmit()) return;

        const user = interaction.user;
        const guild = interaction.guild;

        let category, channelName, embedFields = [];

        if (interaction.customId.startsWith('modal_inne')) {
            const opis = interaction.fields.getTextInputValue('opis_problem');
            category = 'INNE';
            channelName = `❓|${user.username}`;

            embedFields = [
                { name: '💡 Informacje o użytkowniku', value: `> Ping: ${user}\n> TAG: ${user.tag}\n> ID: ${user.id}` },
                { name: '📝 Opis problemu', value: `> ${opis}` }
            ];

        } else if (interaction.customId.startsWith('modal_zakupy')) {
            const produkt = interaction.fields.getTextInputValue('produkt');
            const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
            const platnosc = interaction.fields.getTextInputValue('platnosc');
            category = 'ZAKUPY';
            channelName = `🛒|${user.username}`;

            embedFields = [
                { name: '💡 Informacje o użytkowniku', value: `> Ping: ${user}\n> TAG: ${user.tag}\n> ID: ${user.id}` },
                { name: '💰 Informacje o transakcji', value: `> ID Transakcji: ${ticketCounter}\n> Kategoria: ${category}\n> Produkt: ${produkt}\n> Wydawnictwo: ${wydawnictwo}\n> Metoda płatności: ${platnosc}` }
            ];
        }

        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: 0,
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

    // Przyciski admina
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
            await interaction.reply({ content: 'Panel admina otwarty. (Do uzupełnienia dalsze funkcje)', ephemeral: true });
        }
    });
};
