import axios from "axios";
import * as Discord from "discord.js";
import { OnlyInstantiableByContainer, Singleton, Inject } from "typescript-ioc";

import { BaseService } from "../base/BaseService";
import { ArkhamDBCard, CardService } from "./card";
import { EmojiService } from "./emoji";
import { LoggerService } from "./logger";

type Slots = { [cardCode: string]: number };

interface ArkhamDBDeck {
  id: number;
  name: string;
  investigator_code: string;
  investigator_name: string;
  slots: Slots;
  sideSlots: Slots;
  ignoreDeckLimitSlots: Slots;
}

interface WithQuantity {
  quantity: number;
}

type CardInDeck = ArkhamDBCard & WithQuantity;

interface DeckCategory {
  title: string;
  filter: (card: CardInDeck) => boolean;
  subcategories?: DeckCategory[];
}

const DECK_CATEGORIES: DeckCategory[] = [
  {
    title: "Soutiens",
    filter: (card: CardInDeck) => card.type_code === "asset" && !card.permanent,
    subcategories: [
      { title: "Main", filter: (card: CardInDeck) => card.slot === "Main" },
      {
        title: "Main x2",
        filter: (card: CardInDeck) => card.slot === "Main x2",
      },
      {
        title: "Accessoire",
        filter: (card: CardInDeck) => card.slot === "Accessoire",
      },
      { title: "Corps", filter: (card: CardInDeck) => card.slot === "Corps" },
      { title: "Allié", filter: (card: CardInDeck) => card.slot === "Allié" },
      { title: "Arcane", filter: (card: CardInDeck) => card.slot === "Arcane" },
      {
        title: "Arcane x2",
        filter: (card: CardInDeck) => card.slot === "Arcane x2",
      },
      { title: "Tarot", filter: (card: CardInDeck) => card.slot === "Tarot" },
      {
        title: "Autre",
        filter: (card: CardInDeck) =>
          typeof card.slot === "undefined" ||
          ![
            "Main",
            "Main x2",
            "Accessoire",
            "Corps",
            "Allié",
            "Arcane",
            "Arcane x2",
            "Tarot",
          ].includes(card.slot),
      },
    ],
  },
  {
    title: "Permanent",
    filter: (card: CardInDeck) => card.permanent,
  },
  {
    title: "Evénements",
    filter: (card: CardInDeck) => card.type_code === "event" && !card.permanent,
  },
  {
    title: "Compétences",
    filter: (card: CardInDeck) => card.type_code === "skill" && !card.permanent,
  },
  {
    title: "Traîtrises",
    filter: (card: CardInDeck) =>
      card.type_code === "treachery" && !card.permanent,
  },
  {
    title: "Ennemis",
    filter: (card: CardInDeck) => card.type_code === "enemy" && !card.permanent,
  },
];

const CLASS_ICONS: { [faction: string]: string } = {
  guardian: "ClassGuardian",
  seeker: "ClassSeeker",
  rogue: "ClassRogue",
  mystic: "ClassMystic",
  survivor: "ClassSurvivor",
};

const byCardName = (c1: CardInDeck, c2: CardInDeck): number => {
  if (c1.name === c2.name) {
    return 0;
  }
  if (c1.name > c2.name) {
    return 1;
  }
  return -1;
};

@Singleton
@OnlyInstantiableByContainer
export class DeckService extends BaseService {
  @Inject private cardService?: CardService;
  @Inject private emojiService?: EmojiService;
  @Inject private logger?: LoggerService;

  public async init(client: Discord.Client): Promise<void> {
    await super.init(client);
  }

  public async getDeck(deckId: string): Promise<ArkhamDBDeck | undefined> {
    try {
      const response = await axios.get<ArkhamDBDeck>(
        `https://arkhamdb.com/api/public/deck/${deckId}`,
        { maxRedirects: 0 }
      );
      if (response.status === 200) {
        return response.data;
      }
    } catch (error) {
      if (axios.isAxiosError(error) && !error.response && error.request) {
        if (this.logger) {
          this.logger.error(error);
        }
      }
    }
  }

  public createEmbed(deck: ArkhamDBDeck): Discord.MessageEmbed {
    const embed = new Discord.MessageEmbed();
    embed.setTitle(deck.name);
    embed.setURL(`https://fr.arkhamdb.com/deck/view/${deck.id}`);

    const cardsInDeck = this.addCardData(deck.slots);

    let desc = deck.investigator_name;

    DECK_CATEGORIES.forEach(({ title, filter, subcategories }) => {
      const cardsInCategory = cardsInDeck.filter(filter).sort(byCardName);
      if (cardsInCategory.length > 0) {
        const numberOfCard = cardsInCategory.reduce(
          (sum, card) => sum + card.quantity,
          0
        );
        desc += `\n\n**${title}** (${numberOfCard})`;
        if (subcategories) {
          subcategories.forEach((subcategory) => {
            const cardsInSubcategory = cardsInCategory.filter(
              subcategory.filter
            );
            if (cardsInSubcategory.length > 0) {
              desc += `\n__${subcategory.title}__\n`;
              desc += cardsInSubcategory
                .map((card) => this.formatCard(card))
                .join("\n");
            }
          });
        } else {
          desc += "\n";
          desc += cardsInCategory
            .map((card) => this.formatCard(card))
            .join("\n");
        }
      }
    });

    embed.setDescription(desc);

    return embed;
  }

  private addCardData(slots: Slots): CardInDeck[] {
    if (!this.cardService) {
      return [];
    }
    const surelyCardService = this.cardService;

    const cardsInDeck: CardInDeck[] = [];

    Object.keys(slots).forEach((cardCode) => {
      const card = surelyCardService.getCards(cardCode, {
        cardPool: "player",
        searchType: "by_code",
        returns: "single",
      });
      if (card.length > 0) {
        cardsInDeck.push({ ...card[0], quantity: slots[cardCode] });
      }
    });

    return cardsInDeck;
  }

  private formatCard(cardInDeck: CardInDeck): string {
    const level = cardInDeck.xp || 0;
    const signature = typeof cardInDeck.xp === "undefined";
    let classEmoji = "";

    const classIcon = CLASS_ICONS[cardInDeck.faction_code];
    if (classIcon && this.emojiService) {
      classEmoji = this.emojiService.getEmoji(classIcon);
    }

    /*return `${cardInDeck.quantity}x ${classEmoji} ${
      cardInDeck.name
    } ${"•".repeat(level)}${signature ? " ★" : ""}`;*/
    return `${cardInDeck.quantity}x ${classEmoji} [${
      cardInDeck.name
    }](https://fr.arkhamdb.com/card/${cardInDeck.code}) ${"•".repeat(level)}${
      signature ? " ★" : ""
    }`;
  }
}