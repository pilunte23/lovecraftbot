import {
  CommandInteraction,
  SelectMenuInteraction,
  SlashCommandBuilder
} from "discord.js";
import { Inject } from "typescript-ioc";

import {
  ApplicationCommandAccess,
  IApplicationCommand,
  IApplicationCommandResult,
} from "../interfaces";
import { ArkhamDBCard, CardService, SearchType } from "../services/CardService";

import { selectCard } from "./utils/selectCard";

/** Options de recherche et d'affichage des cartes */
interface SearchOptions {
  /** Pour un affichage complet */
  extended: boolean;

  /** Pour affichage du dos de la carte */
  back: boolean;

  /** Type de recherche */
  searchType: SearchType;

  /** Recherche */
  searchString: string;

  /** Pour un affichage éphémère */
  ephemeral: boolean;
}

/**
 * Commande pour l'affichage des cartes
 */
export class CardCommand implements IApplicationCommand {
  @Inject private cardService!: CardService;

  commandAccess = ApplicationCommandAccess.GLOBAL;



  commandData = new SlashCommandBuilder()
    .setName("c")
    .setDescription(`Pour l'affichage de carte(s)`)
    .addStringOption((option) =>
      option
        .setName("recherche")
        .setDescription(
          "Code de la carte ou texte à chercher dans le titre de la carte"
        )
        .setRequired(true)
    )
    .addBooleanOption((option) =>
      option
        .setName("complet")
        .setDescription(
          "Pour envoyer une description complète de la carte (et non seulement l'image)"
        )
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName("dos")
        .setDescription("Pour envoyer le dos de la carte")
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName("ephemere")
        .setDescription("Si vrai, seul toi pourra voir la réponse")
        .setRequired(false)
    );

  async execute(
    interaction: CommandInteraction
  ): Promise<IApplicationCommandResult> {
    if (!interaction.isChatInputCommand()) {
      await interaction.reply("Oups, y'a eu un problème");
      return { cmd: "CardCommand", result: "Interaction hors chat" };
    }
    const search = interaction.options.getString("recherche");
    const extended = interaction.options.getBoolean("complet") || false;
    const back = interaction.options.getBoolean("dos") || false;
    const ephemeral =
    interaction.options.getBoolean("ephemere") || false;

    if (search) {
      const searchOptions: SearchOptions = {
        extended,
        back,
        searchType: CardService.CARD_CODE_REGEX.test(search)
          ? SearchType.BY_CODE
          : SearchType.BY_TITLE,
        searchString: search,
        ephemeral,
      };

      let foundCards: ArkhamDBCard[] = [];
      foundCards = this.cardService.getCards({
        searchString: searchOptions.searchString,
        searchType: searchOptions.searchType,
      });

      if (foundCards.length > 0) {
        if (foundCards.length === 1) {
          return this.sendCard(
            interaction,
            foundCards[0],
            searchOptions
          );
        } else {
          return this.sendCardChoices(
            interaction,
            foundCards,
            searchOptions
          );
        }
      } else {
        await interaction.reply(
          "Désolé, le mystère de cette carte reste entier."
        );
        return {
          cmd: "CardCommand",
          result: `Aucune carte correspondant à la recherche ${search}`,
        };
      }
    } else {
      return { cmd: "CardCommand", result: "Texte recherché non fourni" };
    }
  }

  /**
   * Envoie la carte trouvée.
   *
   * @param interaction L'interaction déclenchée par la commande
   * @param card La carte à afficher
   * @param options Les options d'affichage
   * @returns Une promesse résolue avec le résultat de la commande
   */
  private async sendCard(
    interaction: CommandInteraction | SelectMenuInteraction,
    card: ArkhamDBCard,
    options: SearchOptions
  ): Promise<IApplicationCommandResult> {
    const cardEmbeds = await this.cardService.createEmbeds(card, {
      back: options.back,
      extended: options.extended,
    });
    await interaction.reply({
      embeds: cardEmbeds,
      ephemeral: options.ephemeral,
    });
    return { cmd: "CardCommand", result: `Carte envoyée` };
  }

  /**
   * Envoie à l'utilisateur un menu de sélection de carte parmi plusieurs cartes
   * ramenées par la recherche effectuée.
   *
   * @param interaction L'interaction déclenchée par la commande
   * @param cards Les cartes trouvées parmi lesquelles choisir
   * @param options Les options d'affichage
   * @returns Une promesse résolue avec le résultat de la commande
   */
  private async sendCardChoices(
    interaction: CommandInteraction,
    cards: ArkhamDBCard[],
    options: SearchOptions
  ): Promise<IApplicationCommandResult> {
    return selectCard(
      "CardCommand",
      interaction,
      cards,
      async (selectMenuInteraction, selectedCard) => {
        await this.sendCard(selectMenuInteraction, selectedCard, options);
      }
    );
  }
}
