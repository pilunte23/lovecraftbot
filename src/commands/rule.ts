//import * as Discord from "discord.js";
import { Inject } from "typescript-ioc";

import { ICommand, ICommandArgs, ICommandResult } from "../interfaces";
import { RulesService } from "../services/rules";
import { DiscordMenu } from "../utils/DiscordMenu";

export class RuleCommand implements ICommand {
  aliases = ["rule", "règle", "regle"];
  help = "Affiche la règle correspondante";

  @Inject private rulesService?: RulesService;

  async execute(cmdArgs: ICommandArgs): Promise<ICommandResult> {
    if (!this.rulesService) {
      return {
        resultString: `[RuleCommand] RulesService absent`,
      };
    }

    const { message, args } = cmdArgs;
    const maybeRule = this.rulesService.getRule(args);
    if (maybeRule) {
      const responses = this.rulesService.createEmbeds(maybeRule);
      if (responses.length > 1) {
        const menu = new DiscordMenu(responses);
        await menu.replyTo(message);
      } else {
        await message.reply(responses[0]);
      }

      return {
        resultString: `[RuleCommand] Règle envoyée`,
      };
    } else {
      await message.reply("désolé, je ne trouve pas de règle correspondante");
      return {
        resultString: `[RuleCommand] Pas de règle trouvée pour ${args}`,
      };
    }
  }
}