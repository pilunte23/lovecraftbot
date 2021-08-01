import { OnlyInstantiableByContainer, Singleton, Inject } from "typescript-ioc";
import { BaseService } from "../base/BaseService";
import { RandomService } from "./RandomService";
import { EmojiService } from "./EmojiService";

@Singleton
@OnlyInstantiableByContainer
export class ChaosBagService extends BaseService {
  constructor(
    @Inject private randomService: RandomService,
    @Inject private emojiService: EmojiService
  ) {
    super();
  }

  NIGHT_OF_THE_ZEALOT_STANDARD_BAG = [
    "p1",
    "p0",
    "p0",
    "m1",
    "m1",
    "m1",
    "m2",
    "m2",
    "m3",
    "m4",
    "ChaosSkull",
    "ChaosSkull",
    "ChaosCultist",
    "ChaosTablet",
    "ChaosFail",
    "ChaosElderSign",
  ];

  TOKENS: { [key: string]: string } = {
    p1: "+1",
    p0: "0",
    m1: "-1",
    m2: "-2",
    m3: "-3",
    m4: "-4",
    ChaosSkull: "Skull",
    ChaosCultist: "Cultist",
    ChaosTablet: "Tablet",
    ChaosFail: "Autofail",
    ChaosElderSign: "Elder Sign",
  };

  public pullToken(): string | undefined {
    const tokenString =
      this.NIGHT_OF_THE_ZEALOT_STANDARD_BAG[
        this.randomService.getRandomInt(
          0,
          this.NIGHT_OF_THE_ZEALOT_STANDARD_BAG.length
        )
      ];
    const emoji = this.emojiService.getEmoji(tokenString);
    return emoji || this.TOKENS[tokenString];
  }
}
