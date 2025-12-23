const { 
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    Events,
    PermissionsBitField
} = require('discord.js');

let ticketCounter = 0; // licznik ticketów w sesji bota

module.exports = (client) => {
    const TICKET_CHANNEL_ID = '1312759128627871816';
    const ADMIN_ROLE_ID = '1436376487157694586';

    // Pomocniczka zwracająca emoji (jeśli bot ma do nich dostęp) lub pusty string
    const getEmoji = (id) => client.emojis.cache.get(id)?.toString() || '';

    // Funkcja wysyłająca "setup" wiadomość z wyborem kategorii (publicznie w kanale)
    const sendSetupMessage = async (channel) => {
        const embed = new EmbedBuilder()
            .setTitle('💡 Wybierz kategorię')
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
            ])
            .setMinValues(1)
            .setMaxValues(1);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return channel.send({ embeds: [embed], components: [row] });
    };

    // Wyślij setup message przy starcie (jeśli kanał istnieje)
    client.once(Events.ClientReady, async () => {
        try {
            const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
            if (!channel) {
                console.log('Nie znaleziono kanału ticketowego!');
                return;
            }

            await sendSetupMessage(channel);
            console.log('✅ Embed ticketowy wysłany!');

        } catch (error) {
            console.error('Błąd przy wysyłaniu embedu ticketowego:', error);
        }
    });

    // (Opcjonalne) Obsługa komendy slash /setup — jeśli ktoś użył /setup w trybie prywatnym, to nie będzie błędu,
    // komenda ta wyśle publicznie wiadomość w kanale, gdzie komenda została użyta.
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;
        if (interaction.commandName !== 'setup') return;

        // wymagamy uprawnień administracyjnych do ponownego wysłania embedu
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
            !interaction.member.roles.cache.has(ADMIN_ROLE_ID)) {
            await interaction.reply({ content: '❌ Nie masz uprawnień do uruchomienia tej komendy.', ephemeral: true });
            return;
        }

        try {
            await sendSetupMessage(interaction.channel);
            await interaction.reply({ content: '✅ Wiadomość z wyborem kategorii została wysłana publicznie na tym kanale.', ephemeral: true });
        } catch (err) {
            console.error('Błąd przy /setup:', err);
            await interaction.reply({ content: '❌ Wystąpił błąd podczas wysyłania wiadomości.', ephemeral: true });
        }
    });

    // Wybór kategorii -> pokazanie modala
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'ticket_category') return;

        // Ważne: nie stosujemy żadnych ograniczeń ról tutaj — każdy na serwerze może otwierać tickety.
        // Problem "Only the person who initiated the setup can interact with this customization" pojawia się
        // gdy setup został wysłany jako odpowiedź prywatna (ephemeral) do jednej osoby. Rozwiązanie:
        // - upewnij się, że wiadomość z wyborem kategorii jest wysłana publicznie (nie jako ephemeral),
        //   np. poprzez /setup który wysyła wiadomość channel.send (jak wyżej).
        // - tutaj zakładamy, że wiadomość jest publiczna i każdy może z niej korzystać.

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

        // Pobierz emoji (jeśli bot ma do nich dostęp)
        const ePing = getEmoji('1453068281979076691');         // (emoji ID: 1453068281979076691) Ping
        const eTag = getEmoji('1452951976785481741');          // (emoji ID: 1452951976785481741) TAG
        const eUserId = getEmoji('1452715580456042647');       // (emoji ID: 1452715580456042647) User ID
        const eSpacer = getEmoji('1452712355002585330');       // (emoji ID: 1452712355002585330) spacer / dekoracja
        const eTrans = getEmoji('1453070829285019658');        // (emoji ID: 1453070829285019658) transaction bullet

        let category, channelName, embedFields = [];

        if (interaction.customId.startsWith('modal_inne')) {
            const opis = interaction.fields.getTextInputValue('opis_problem');
            category = 'INNE';
            channelName = `❓|${user.username}`;

            embedFields = [
                {
                    name: 'User Information:',
                    value:
                        `${ePing} Ping: <@${user.id}>\n` +
                        `${eTag} TAG: ${user.username}\n` +
                        `${eUserId} User ID: ${user.id}`
                },
                { name: 'Opis problemu', value: `> ${opis}` }
            ];

        } else if (interaction.customId.startsWith('modal_zakupy')) {
            const produkt = interaction.fields.getTextInputValue('produkt');
            const wydawnictwo = interaction.fields.getTextInputValue('wydawnictwo');
            const platnosc = interaction.fields.getTextInputValue('platnosc');
            category = 'ZAKUPY';
            channelName = `🛒|${user.username}`;

            embedFields = [
                {
                    name: 'User Information:',
                    value:
                        `${ePing} Ping: <@${user.id}>\n` +
                        `${eTag} TAG: ${user.username}\n` +
                        `${eUserId} User ID: ${user.id} ${eSpacer}`
                },
                {
                    name: `${eTrans} Transaction Information:`,
                    value:
                        `${eTrans} Transaction ID: ${ticketCounter}\n` +
                        `${eTrans} Ticket Category: ${category}\n` +
                        `${eTrans} Product: ${produkt}\n` +
                        `${eTrans} Publisher: ${wydawnictwo}\n` +
                        `${eTrans} Payment Method: ${platnosc}`
                }
            ];
        } else {
            await interaction.reply({ content: '❌ Nieznany modal.', ephemeral: true });
            return;
        }

        // Tworzenie kanału ticketowego z uprawnieniami
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: 0,
            permissionOverwrites: [
                { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                { id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] }
            ]
        });

        // Miniaturka ticketa (po prawej) - avatar użytkownika, nie logo serwera
        const ticketEmbed = new EmbedBuilder()
            .setTitle(`Ticket #${ticketCounter} | ${category}`)
            .setColor(category === 'ZAKUPY' ? 'Red' : 'Orange')
            .setFields(embedFields)
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }));

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

    // Przyciski admina (tylko role administracyjne)
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

        const member = interaction.member;
        if (!member) return;

        // tylko osoby z rolą ADMIN_ROLE_ID lub z uprawnieniami ManageChannels mogą korzystać z przycisków admina
        if (!member.roles.cache.has(ADMIN_ROLE_ID) && !member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            await interaction.reply({ content: '❌ Nie masz uprawnień do użycia tego przycisku.', ephemeral: true });
            return;
        }

        const channel = interaction.channel;
        if (!channel.name.startsWith('❓|') && !channel.name.startsWith('🛒|')) {
            await interaction.reply({ content: '❌ To nie jest kanał ticketowy.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'close_ticket') {
            await channel.delete();
            await interaction.reply({ content: '✅ Ticket został zamknięty.', ephemeral: true });
            return;
        }

        if (interaction.customId === 'admin_panel') {
            await interaction.reply({ content: 'Panel administracyjny otwarty (funkcje do uzupełnienia).', ephemeral: true });
            return;
        }
    });
};