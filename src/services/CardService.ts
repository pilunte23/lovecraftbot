import axios from "axios";
import * as Discord from "discord.js";
import { OnlyInstantiableByContainer, Singleton, Inject } from "typescript-ioc";

import { BaseService } from "../base/BaseService";

import { FormatService } from "./FormatService";
import { LoggerService } from "./LoggerService";
import { ResourcesService } from "./ResourcesService";

/** Couleurs associées au différentes classes */
const CLASS_COLORS = {
  guardian: 0x2b80c5,
  seeker: 0xff8f3f,
  rogue: 0x107116,
  mystic: 0x6d2aa9,
  survivor: 0xcc3038,
  multiclass: 0xc0c000,
  neutral: 0x808080,
  mythos: 0xfcfcfc,
};

/** Classe Horreur à Arkham */
export type FactionCode =
  | "guardian"
  | "seeker"
  | "rogue"
  | "mystic"
  | "survivor"
  | "neutral"
  | "mythos";

/**
 * Une carte renvoyée par l'API d'ArkhamDB
 */
export interface ArkhamDBCard {
  code: string;
  name: string;
  real_name: string;
  xp: number;
  permanent: boolean;
  double_sided: boolean;
  faction_code: FactionCode;
  faction2_code?: FactionCode;
  faction3_code?: FactionCode;
  encounter_code?: string;
  type_code: string;
  pack_code: string;
  text: string;
  imagesrc: string;
  back_text: string;
  backimagesrc: string;
  skill_willpower: number;
  skill_intellect: number;
  skill_combat: number;
  skill_agility: number;
  skill_wild: number;
  cost: string;
  slot: string;
}

/**
 * Type représentant une liste Taboo
 */
interface ArkhamDBTaboo {
  /** Date de publication de cette liste Taboo */
  start_date: string;

  /** Contenu de la liste Taboo */
  cards: string;
}

/**
 * Type représentant les modifications apportées à une carte par une liste
 * Taboo.
 */
interface Taboo {
  /** Code de la carte */
  code: string;

  /** Points d'XP ajoutés ou retirés */
  xp: number;

  /** Description des modifications apportées */
  text: string;
}

/**
 * Type représentant une entrée de FAQ pour une carte.
 */
interface CardFAQEntry {
  /** Le texte de la FAQ */
  text: string;
}

/**
 * Type générique pour tout ce qui a un code et un nom
 */
interface CodeAndName {
  /** Le code */
  code: string;
  /** Le nom */
  name: string;
}

/**
 * Recherche un code dans une liste de paires `[code, nom]` et renvoie le
 * nom associé ou, à défaut, le code qui était cherché.
 *
 * @param dict Une liste de paires `[code, nom]` dans laquelle chercher
 * @param search Le code recherché
 * @returns Le nom correspondant au code recherché ou, à défaut, le code
 *          recherché
 */
function findOrDefaultToCode(dict: CodeAndName[], search: string): string {
  const found = dict.find((codeAndName) => codeAndName.code === search);
  if (found) {
    return found.name;
  }
  return search;
}

/**
 * Type de recherche de carte
 */
export enum SearchType {
  /** Recherche par code de carte */
  BY_CODE,

  /** Recherche par titre de carte */
  BY_TITLE,
}

/**
 * Type représentant les paramètres d'une recherche
 */
interface SearchParams {
  /** La valeur recherchée */
  searchString: string;

  /** Le type de recherche */
  searchType?: SearchType;
}

/**
 * Type représentant les options d'affichage de la carte
 */
interface EmbedOptions {
  /** Vrai pour une description complète, faux pour un affichage de la carte uniquement */
  extended: boolean;

  /** Vrai pour un affichage du dos de la carte */
  back: boolean;
}

/**
 * Vérifie si le titre français ou anglais de la carte contient la chaîne de
 * texte fournie.
 *
 * @param card La carte à analyser
 * @param searchString Le texte à chercher dans le titre
 * @returns Vrai si le titre de la carte contient le texte recherché
 */
function matchCard(card: ArkhamDBCard, searchString: string): boolean {
  return (
    card.name.toLowerCase().includes(searchString.toLowerCase()) ||
    card.real_name.toLowerCase().includes(searchString.toLowerCase())
  );
}

@Singleton
@OnlyInstantiableByContainer
/**
 * Service permettant différentes opérations en lien avec les cartes
 * du jeu.
 * Les données proviennent d'ArkhamDB (https://arkhamdb.com/) et sont
 * stockées localement dans un fichier JSON pour limiter les appels à l'API
 * et pouvoir effectuer des recherches.
 */
export class CardService extends BaseService {
  /** Etiquette utilisée pour les logs de ce service */
  private static LOG_LABEL = "CardService";

  /** Liste des cartes */
  private frenchCards: ArkhamDBCard[] = [];
  /** Liste des Taboos */
  private taboos: Taboo[] = [];
  /** Liste des factions */
  private factions: CodeAndName[] = [];
  /** Liste des packs de cartes */
  private packs: CodeAndName[] = [];
  /** Liste des types de carte */
  private types: CodeAndName[] = [];

  @Inject private formatService!: FormatService;
  @Inject private logger!: LoggerService;
  @Inject private resources!: ResourcesService;

  public async init(client: Discord.Client): Promise<void> {
    await super.init(client);

    await this.loadCards();
    await this.loadTaboos();
    await this.loadFactions();
    await this.loadPacks();
    await this.loadTypes();
  }

  /**
   * Renvoie le nom français d'une carte à partir de son nom anglais
   * (correspondance exacte).
   *
   * @param englishName Nom anglais de la carte
   * @returns Le nom français de la carte si trouvé
   */
  public getFrenchCardName(englishName: string): string | undefined {
    const foundCard = this.frenchCards.find(
      (card) =>
        card.real_name.toLocaleLowerCase() === englishName.toLocaleLowerCase()
    );
    if (foundCard && foundCard.name !== foundCard.real_name)
      return foundCard.name;
    return undefined;
  }

  /**
   * Renvoie le nom angalis d'une carte à partir de son nom français
   * (correspondance exacte).
   *
   * @param frenchName Nom français de la carte
   * @returns Le nom anglais de la carte si trouvé
   */
  public getEnglishCardName(frenchName: string): string | undefined {
    const foundCard = this.frenchCards.find(
      (card) => card.name.toLocaleLowerCase() === frenchName.toLocaleLowerCase()
    );
    if (foundCard && foundCard.real_name !== foundCard.name)
      return foundCard.real_name;
    return undefined;
  }

  /**
   * Recherche l'ensemble des cartes répondant aux paramètres de recherche
   * fournis.
   *
   * @param searchParams Les paramètres de la recherche
   * @returns Toutes les cartes correspondant à la recherche
   */
  public getCards({
    searchString,
    searchType = SearchType.BY_TITLE,
  }: SearchParams): ArkhamDBCard[] {
    if (searchType === SearchType.BY_CODE) {
      return this.frenchCards.filter((card) => card.code === searchString);
    }

    return this.frenchCards.filter((card) => matchCard(card, searchString));
  }

  /**
   * Renvoie l'ensemble de codes de cartes joueur (excluant dont les cartes
   * Mythe).
   *
   * @returns Tous les codes de cartes joueur
   */
  public getAllPlayerCardCodes(): string[] {
    return this.frenchCards
      .filter((card) => card.faction_code !== "mythos")
      .filter((card) => card.encounter_code === undefined)
      .map((card) => card.code);
  }

  /**
   * Vérifie si une carte a un dos.
   *
   * @param card La carte
   * @returns Vrai si la carte a un dos
   */
  public hasBack(card: ArkhamDBCard): boolean {
    return !!card.back_text || !!card.backimagesrc;
  }

  /**
   * Créé un encart Discord permettant d'afficher une carte selon les options
   * d'affichage précisées.
   *
   * @param card La carte à afficher
   * @param embedOptions Les options d'affichage
   * @returns Un encart Discord pour l'affichage de la carte
   */
  public async createEmbed(
    card: ArkhamDBCard,
    embedOptions: EmbedOptions
  ): Promise<Discord.MessageEmbed> {
    const embed = new Discord.MessageEmbed();

    const cardFaction = findOrDefaultToCode(this.factions, card.faction_code);
    const cardFaction2 = card.faction2_code
      ? findOrDefaultToCode(this.factions, card.faction2_code)
      : undefined;
    const cardFaction3 = card.faction3_code
      ? findOrDefaultToCode(this.factions, card.faction3_code)
      : undefined;

    const factions = [cardFaction, cardFaction2, cardFaction3]
      .filter((faction) => faction !== undefined)
      .join(" / ");

    const cardType = findOrDefaultToCode(this.types, card.type_code);

    const isMulticlass = !!card.faction2_code;

    embed.setTitle(card.name);
    embed.setURL(`https://fr.arkhamdb.com/card/${card.code}`);

    if (!["neutral", "mythos"].includes(card.faction_code) && !isMulticlass) {
      embed.setAuthor(
        `${cardType} ${factions}`,
        `https://arkhamdb.com/bundles/app/images/factions/${card.faction_code}.png`
      );
    } else {
      embed.setAuthor(`${cardType} ${factions}`);
    }

    embed.setColor(
      isMulticlass ? CLASS_COLORS.multiclass : CLASS_COLORS[card.faction_code]
    );

    const maybeCardImageLink = await this.getCardImageLink(
      card,
      embedOptions.back
    );
    if (maybeCardImageLink) {
      embed.setImage(maybeCardImageLink);
    }

    const cardText = embedOptions.back ? card.back_text : card.text;

    if (embedOptions.extended || !maybeCardImageLink) {
      if (cardText) {
        embed.setDescription(this.formatService.format(cardText));
      }

      if (!embedOptions.back) {
        if (card.xp) {
          embed.addField("Niveau", card.xp.toString(), true);
        }

        if (
          card.faction_code !== "mythos" &&
          card.type_code !== "investigator" &&
          this.formatService
        ) {
          const icons =
            "[willpower]".repeat(card.skill_willpower || 0) +
            "[intellect]".repeat(card.skill_intellect || 0) +
            "[combat]".repeat(card.skill_combat || 0) +
            "[agility]".repeat(card.skill_agility || 0) +
            "[wild]".repeat(card.skill_wild || 0);
          embed.addField(
            "Icônes",
            icons !== "" ? this.formatService.format(icons) : "-",
            true
          );
        }

        if (card.cost) {
          embed.addField("Coût", card.cost.toString(), true);
        }

        const maybePack = this.packs.find(
          (pack) => pack.code == card.pack_code
        );
        if (maybePack) {
          embed.addField("Pack", maybePack.name);
        }

        embed.addField("Nom anglais", card.real_name);
      }
    }

    const maybeTaboo = this.taboos.find((taboo) => taboo.code === card.code);
    if (maybeTaboo) {
      const tabooText = [];
      if (maybeTaboo.xp) {
        tabooText.push(`XP: ${maybeTaboo.xp}`);
      }
      if (maybeTaboo.text) {
        tabooText.push(this.formatService.format(maybeTaboo.text));
      }
      embed.addField("Taboo", tabooText.join("\n"));
    }

    const cardFAQs = await this.getCardFAQ(card);

    const footerParts = [];
    if (!embedOptions.back && this.hasBack(card)) {
      footerParts.push("Cette carte a un dos.");
    }
    if (cardFAQs.length > 0) {
      footerParts.push("Cette carte a une entrée dans la FAQ.");
    }

    if (footerParts.length > 0) {
      embed.setFooter(footerParts.join(" "));
    }

    return embed;
  }

  /**
   * Télécharge (annule et remplace) la dernière version des données des cartes
   * depuis ArkahmDB.
   *
   * @returns Une promesse résolue une fois l'opération terminée
   */
  public async downloadLatestCardDb(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await axios.get<any[]>(
        "https://fr.arkhamdb.com/api/public/cards/?encounter=true"
      );
      await this.resources.saveResource(
        "cards.fr.json",
        JSON.stringify(response.data)
      );
      await this.loadCards();
    } catch (error) {
      this.logger.error(
        CardService.LOG_LABEL,
        "Erreur au téléchargement des dernières cartes",
        { error }
      );
    }
  }

  /**
   * Télécharge (annule et remplace) les derniers packs de cartes depuis
   * ArkhamDB.
   *
   * @returns Une promesse résolue une fois l'opération terminée
   */
  public async downloadLatestPacks(): Promise<void> {
    try {
      const response = await axios.get<unknown[]>(
        "https://fr.arkhamdb.com/api/public/packs/"
      );
      await this.resources.saveResource(
        "packs.json",
        JSON.stringify(response.data)
      );
      await this.loadPacks();
    } catch (error) {
      this.logger.error(
        CardService.LOG_LABEL,
        "Erreur au téléchargement des derbiers packs",
        { error }
      );
    }
  }

  /**
   * Télécharge (annule et remplace) la dernière version des listes Taboo
   * depuis ArkahmDB.
   *
   * @returns Une promesse résolue une fois l'opération terminée
   */
  public async downloadLatestTaboos(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await axios.get<any[]>(
        "https://fr.arkhamdb.com/api/public/taboos"
      );
      await this.resources.saveResource(
        "taboos.json",
        JSON.stringify(response.data)
      );
      await this.loadCards();
    } catch (error) {
      this.logger.error(
        CardService.LOG_LABEL,
        "Erreur au téléchargement des derniers taboos",
        {
          error,
        }
      );
    }
  }

  /**
   * Renvoie un lien vers une image de la carte ou de son dos. Cette fonction
   * va d'abord essayer de trouver un lien vers une image en français puis se
   * rabattre sur un lien vers une image en anglais.
   *
   * @param card La carte dont on cherche l'image
   * @param back Vrai si on souhaite le dos de la carte
   * @returns Une promesse résolue avec le lien vers l'image s'il a été trouvé
   */
  private async getCardImageLink(
    card: ArkhamDBCard,
    back = false
  ): Promise<string | undefined> {
    const maybeFrenchImageLink = await this.getFrenchCardImageLink(card, back);
    if (maybeFrenchImageLink) {
      return maybeFrenchImageLink;
    } else {
      const maybeEnglishImageLink = await this.getEnglishCardImageLink(
        card,
        back
      );
      if (maybeEnglishImageLink) {
        return maybeEnglishImageLink;
      }
    }
  }

  /**
   * Renvoie un lien vers une image en français de la carte si disponible. Le
   * lien est construit grâce au code de la carte et cette fonction fait
   * ensuite une requête HEAD sur ce lien pour vérifier si l'image existe. Si
   * ce n'est pas le cas, cette fonction sera résolue avec `undefined`.
   *
   * @param card La carte dont on cherche l'image
   * @param back Vrai si on souhaite le dos de la carte
   * @returns Une promesse résolue avec le lien vers l'image si elle est disponible
   */
  private getFrenchCardImageLink(
    card: ArkhamDBCard,
    back = false
  ): Promise<string | undefined> {
    return axios
      .head<string>(
        `http://arkhamdb.fr.cr/IMAGES/CARTES/AH-${card.code}${
          back ? "_back" : ""
        }.jpg`
      )
      .then((response) => response.config.url)
      .catch(() => undefined as string | undefined);
  }

  /**
   * Renvoie un lien vers une image en anglais de la carte si disponible. Le
   * lien est construit grâce au code de la carte et cette fonction fait
   * ensuite une requête HEAD sur ce lien pour vérifier si l'image existe. Si
   * ce n'est pas le cas, cette fonction sera résolue avec `undefined`.
   *
   * @param card La carte dont on cherche l'image
   * @param back Vrai si on souhaite le dos de la carte
   * @returns Une promesse résolue avec le lien vers l'image si elle est disponible
   */
  private getEnglishCardImageLink(
    card: ArkhamDBCard,
    back = false
  ): Promise<string | undefined> {
    return axios
      .head<string>(
        `https://arkhamdb.com${back ? card.backimagesrc : card.imagesrc}`
      )
      .then((response) => response.config.url)
      .catch(() => undefined as string | undefined);
  }

  /**
   * Récupère la liste des entrées de FAQ pour la carte précisée. La liste retournée est
   * vide s'il n'y a pas d'entrées de FAQ pour cette carte.
   *
   * @param card La carte concernée
   * @returns Une liste d'entrées de FAQ
   */
  private async getCardFAQ(card: ArkhamDBCard): Promise<CardFAQEntry[]> {
    // TODO Mettre la réponse en cache pour limiter les appels à l'API
    //      et vide le cache à la commande refresh.
    try {
      const response = await axios.get<CardFAQEntry[]>(
        `https://fr.arkhamdb.com/api/public/faq/${card.code}`
      );
      return response.data;
    } catch (_error) {
      return [];
    }
  }

  /**
   * Chargement des factions depuis le fichier qui les stocke.
   *
   * @returns Une promesse résolue une fois le chargement terminé
   */
  private async loadFactions(): Promise<void> {
    const rawData = await this.resources.readResource("factions.json");
    if (rawData) {
      try {
        this.factions = JSON.parse(rawData) as CodeAndName[];
      } catch (error) {
        this.logger.error(
          CardService.LOG_LABEL,
          "Erreur au chargement des factions",
          {
            error,
          }
        );
      }
    }
  }

  /**
   * Chargement des packs de cartes depuis le fichier qui les stocke.
   *
   * @returns Une promesse résolue une fois le chargement terminé
   */
  private async loadPacks(): Promise<void> {
    const dataAvailable = await this.resources.resourceExists("packs.json");
    if (!dataAvailable) {
      await this.downloadLatestPacks();
    }

    const rawData = await this.resources.readResource("packs.json");
    if (rawData) {
      try {
        this.packs = JSON.parse(rawData) as CodeAndName[];
      } catch (error) {
        this.logger.error(
          CardService.LOG_LABEL,
          "Erreur au chargement des packs",
          {
            error,
          }
        );
      }
    }
  }

  /**
   * Chargement des types de cartes depuis le fichier qui les stocke.
   *
   * @returns Une promesse résolue une fois le chargement terminé
   */
  private async loadTypes(): Promise<void> {
    const rawData = await this.resources.readResource("types.json");
    if (rawData) {
      try {
        this.types = JSON.parse(rawData) as CodeAndName[];
      } catch (error) {
        this.logger.error(
          CardService.LOG_LABEL,
          "Erreur au chargement des types",
          {
            error,
          }
        );
      }
    }
  }

  /**
   * Chargement des cartes depuis le fichier qui les stocke.
   *
   * @returns Une promesse résolue une fois le chargement terminé
   */
  private async loadCards(): Promise<void> {
    const dataAvailable = await this.resources.resourceExists("cards.fr.json");
    if (!dataAvailable) {
      await this.downloadLatestCardDb();
    }

    const rawData = await this.resources.readResource("cards.fr.json");
    if (rawData) {
      try {
        this.frenchCards = JSON.parse(rawData) as ArkhamDBCard[];
      } catch (error) {
        this.logger.error(
          CardService.LOG_LABEL,
          "Erreur au chargement des cartes",
          {
            error,
          }
        );
      }
    }
  }

  /**
   * Chargement des listes Taboo depuis le fichier qui les stocke.
   *
   * @returns Une promesse résolue une fois le chargement terminé
   */
  private async loadTaboos(): Promise<void> {
    const dataAvailable = await this.resources.resourceExists("taboos.json");
    if (!dataAvailable) {
      await this.downloadLatestTaboos();
    }

    const rawData = await this.resources.readResource("taboos.json");
    if (rawData) {
      try {
        const allTaboos = JSON.parse(rawData) as ArkhamDBTaboo[];
        if (allTaboos.length > 0) {
          const latestTaboo = allTaboos[0];
          this.taboos = JSON.parse(latestTaboo.cards) as Taboo[];
        }
      } catch (error) {
        this.logger.error(
          CardService.LOG_LABEL,
          "Erreur au chargement des taboos",
          {
            error,
          }
        );
      }
    }
  }
}
