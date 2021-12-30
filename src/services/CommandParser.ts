import * as Discord from "discord.js";
import { OnlyInstantiableByContainer, Singleton, Inject } from "typescript-ioc";

import { BaseService } from "../base/BaseService";
import * as Commands from "../commands";
import { ICommandResult, ICommand, CommandConstructor } from "../interfaces";

import { EnvService } from "./EnvService";
import { HelpService } from "./HelpService";
import { RoleService } from "./RoleService";

type CommandsDictionary = { [key: string]: CommandConstructor };
const AvailableCommands = Commands as unknown as CommandsDictionary;

@Singleton
@OnlyInstantiableByContainer
export class CommandParser extends BaseService {
  @Inject private envService!: EnvService;
  @Inject private roleService!: RoleService;
  @Inject private helpService!: HelpService;

  private executableCommands: { [key: string]: ICommand } = {};

  private messageCommands: ICommand[] = [];
  private emojiAddCommands: ICommand[] = [];
  private emojiRemoveCommands: ICommand[] = [];

  public async init(client: Discord.Client): Promise<void> {
    await super.init(client);

    this.loadCommands(AvailableCommands);
  }

  // used to parse strings. any command registering this will be listening to all incoming messages.
  // this function returns nothing because it can operate on multiple values
  handleMessage(message: Discord.Message): void {
    this.messageCommands.forEach((cmd) => {
      if (cmd.onMessage) cmd.onMessage(message);
      return;
    });
  }

  // any command registering this will fire their callback when a reaction is added to a message
  // this function returns nothing because it can operate on multiple values
  handleEmojiAdd(
    reaction: Discord.MessageReaction,
    user: Discord.User | Discord.PartialUser
  ): void {
    this.emojiAddCommands.forEach((cmd) => {
      if (cmd.onEmojiAdd) cmd.onEmojiAdd(reaction, user);
      return;
    });
  }

  // any command registering this will fire their callback when a reaction is removed from a message
  // this function returns nothing because it can operate on multiple values
  handleEmojiRemove(
    reaction: Discord.MessageReaction,
    user: Discord.User | Discord.PartialUser
  ): void {
    this.emojiRemoveCommands.forEach((cmd) => {
      if (cmd.onEmojiRemove) cmd.onEmojiRemove(reaction, user);
      return;
    });
  }

  // used to handle commands. each command can register a set of aliases that fire off a callback.
  // no alias overlapping is allowed
  async handleCommand(message: Discord.Message): Promise<ICommandResult> {
    const cmd = message.content.split(" ")[0].substring(1);
    const args = message.content.substring(
      message.content.indexOf(cmd) + cmd.length + 1
    );

    const cmdInst = this.executableCommands[cmd.toLowerCase()];
    if (!cmdInst || !cmdInst.execute) {
      await message.reply(
        `Hmmm, je ne connais pas de commande ${this.envService.commandPrefix}${cmd}. Peut-être devrais-tu essayer /aide ?`
      );
      return { resultString: `Pas de commande pour ${cmd}` };
    }

    if (cmdInst.admin) {
      const botAdminRole = this.envService.botAdminRoleName;
      if (!botAdminRole) {
        throw new Error(
          `La commande ${cmd} requiert des droits Admin mais ce rôle n'a pas été défini via BOT_ADMIN_ROLE`
        );
      }
      if (!this.roleService.isMessageFromRole(message, botAdminRole)) {
        return {
          resultString: `La commande ${cmd} est une commande Admin et ${message.author.username} n'a pas ce rôle`,
        };
      }
    }

    return cmdInst.execute({
      debug: false,
      cmd,
      args,
      message,
      user: message.author,
    });
  }

  private loadCommands(commands: CommandsDictionary): void {
    Object.values(commands).forEach((cmdCtor) => {
      const cmdInst: ICommand = new cmdCtor();
      this.registerCommand(cmdInst);
    });
  }

  private registerCommand(cmdInst: ICommand) {
    if (cmdInst.help && cmdInst.aliases) {
      this.helpService.addHelp({
        command: cmdInst.constructor.name,
        aliases: cmdInst.aliases,
        help: cmdInst.help,
        admin: cmdInst.admin !== undefined && cmdInst.admin,
      });
    }

    if (cmdInst.aliases) {
      cmdInst.aliases.forEach((alias) => {
        alias = alias.toLowerCase();

        if (this.executableCommands[alias]) {
          throw new Error(
            `Cannot re-register alias "${alias}".
            Trying to register ${JSON.stringify(
              cmdInst
            )} but already registered ${JSON.stringify(
              this.executableCommands[alias]
            )}.`
          );
        }

        if (!cmdInst.execute) {
          throw new Error(
            `Command "${alias}" does not have an execute function.`
          );
        }
        this.executableCommands[alias] = cmdInst;
      });
    }

    if (cmdInst.onMessage) {
      this.messageCommands.push(cmdInst);
    }

    if (cmdInst.onEmojiAdd) {
      this.emojiAddCommands.push(cmdInst);
    }

    if (cmdInst.onEmojiRemove) {
      this.emojiRemoveCommands.push(cmdInst);
    }
  }
}
