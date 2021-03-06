
import { Component, JsonObject, IHash, Config, Json } from "merapi";
import { v4 as uuid } from "node-uuid";
import { ICompile, IHelper, ITester } from "interfaces/main";
const colors = require("colors");
const inquirer = require("inquirer");
const repl = require("repl");
const util = require("util");
const deasync = require("deasync");
const Table = require("cli-table");

export default class Bot extends Component {
    constructor(private compile: ICompile, private helper: IHelper, private tester: ITester, private api: any) {
        super();
    }

    init(bot: string, name: string, version: string, options: JsonObject) {
        if (!version)
            version = "0.0.1";

        let botDesc = {
            schema: "kata.ai/schema/kata-ml/1.0",
            name,
            desc: "Bot Description",
            version,
            flows: {
                "fallback": "$include(./flows/fallback.yml)"
            },
            config: {
                "messages": "$include(./messages.yml)",
                "maxRecursion": 10
            },
            nlus: "$include(./nlu.yml)",
            methods: {
                'confidenceLevel(message,context,data,options,config)': {
                    code: 'function confidenceLevel(message, context, data, options, config) { if (message.content === "hi") return 1; return 0; }',
                    entry: "confidenceLevel"
                }
            },
            id: bot ? bot : uuid()
        }

        let fallbackFlow = {
            priority: 0,
            fallback: true,
            intents: {
                hi: {
                    initial: true,
                    type: "text",
                    classifier: {
                        nlu: "confidenceLevel",
                        match: 1
                    }
                },
                dunno: {
                    fallback: true
                }
            },
            states: {
                init: {
                    initial: true,
                    transitions: {
                        sayHi: {
                            condition: "intent==\"hi\""
                        },
                        sorry: {
                            fallback: true
                        }
                    }
                },
                sayHi: {
                    end: true,
                    action: [{ name: "sayHi" }]
                },
                sorry: {
                    end: true,
                    action: [{ name: "saySorry" }],
                }
            },
            actions: {
                sayHi: {
                    type: "text",
                    options: {
                        data: "$(config.messages)",
                        path: "templates",
                        template: "$[sayHi]"
                    }
                },
                saySorry: {
                    type: "text",
                    options: {
                        data: "$(config.messages)",
                        path: "templates",
                        template: "$[saySorry]"
                    }
                }
            }
        };

        let messages = {
            templates: {
                sayHi: "Hi, ada yang bisa saya bantu?",
                saySorry: "Maaf, saya tidak mengerti kata-kata anda."
            }
        };

        let nlus = {
            confidenceLevel: {
                type: "method",
                method: "confidenceLevel"
            }
        }

        this.helper.createDirectory("./flows", 0o755);
        this.helper.dumpYaml("./bot.yml", botDesc);
        this.helper.dumpYaml("./flows/fallback.yml", fallbackFlow);
        this.helper.dumpYaml("./messages.yml", messages);
        this.helper.dumpYaml("./nlu.yml", nlus);

        console.log("INIT BOT SUCCESSFULLY");
    }

    async versions(options: JsonObject) {
        let botId = this.helper.getBotId();

        if (!botId)
            throw new Error("BOT ID HAS NOT DEFINED");

        try {
            let { data, response } = await this.helper.toPromise(this.api.botApi, this.api.botApi.botsBotIdVersionsGet, botId);
            if (data) {
                console.log("Bot Versions : ");
                data.versions.forEach((bot: string) => {
                    let msg = bot.split("-");
                    if (msg.length > 1)
                        console.log(`- ${msg[0]} (${msg[1]})`);
                    else
                        console.log(`- ${msg[0]}`);
                });
            } else {
                console.log("You must push at least 1 bot to acquire version");
            }

        } catch (e) {
            this.helper.wrapError(e);
        }
    }

    async test(file: string, options: JsonObject) {
        let testFiles = file ? [file] : this.helper.getFiles("./test", ".spec.yml");
        let botId = this.helper.getBotId();

        if (!botId)
            throw new Error("BOT ID HAS NOT DEFINED");

        let results: JsonObject = {};

        for (let i = 0; i < testFiles.length; i++) {
            let yaml = this.helper.loadYaml(testFiles[i]);
            let res;

            switch (yaml.schema) {
                case "kata.ai/schema/kata-ml/1.0/test/intents":
                    res = await this.tester.execIntentTest(yaml, this.api.botApi, botId, console.log);
                    if (this.hasErrors(res))
                        results[testFiles[i]] = res;
                    break;
                case "kata.ai/schema/kata-ml/1.0/test/states":
                    res = await this.tester.execStateTest(yaml, this.api.botApi, botId, console.log);
                    if (this.hasErrors(res))
                        results[testFiles[i]] = res;
                    break;
                case "kata.ai/schema/kata-ml/1.0/test/actions":
                    res = await this.tester.execActionsTest(yaml, this.api.botApi, botId, console.log);
                    if (this.hasErrors(res))
                        results[testFiles[i]] = res;
                    break;
                case "kata.ai/schema/kata-ml/1.0/test/flow":
                    res = await this.tester.execFlowTest(yaml, this.api.botApi, botId, console.log);
                    if (this.hasErrors(res))
                        results[testFiles[i]] = res;
                    break;
            }
        }

        this.printResult(<IHash<IHash<{ field: string, expect: string, result: string }[]>>>results);
    }

    private hasErrors(res: any) {
        return Object.keys(res).some(key => (res[key] && res[key].length) || res[key] === null);
    }

    private printResult(results: IHash<IHash<{ field: string, expect: string, result: string }[]>> = {}) {
        if (Object.keys(results).length) {
            console.log(colors.red("Errors:"));
            for (let i in results) {
                console.log(`    ${i}:`)
                for (let j in results[i]) {
                    if (!results[i][j]) {
                        console.log(`        ${colors.red(j + ":")}`);
                        console.log(`            diaenne returns ${colors.red("null")}`);
                        continue;
                    }
                    if (results[i][j].length) {
                        console.log(`        ${colors.red(j + ":")}`);

                        results[i][j].forEach(res => {
                            console.log(`            expecting ${res.field} to be ${colors.green(res.expect)} but got ${colors.red(res.result)}`);
                        });
                    }
                }
            }
        }
    }

    async list(options: JsonObject) {
        try {
            let { data, response } = await this.helper.toPromise(this.api.botApi, this.api.botApi.botsGet, {});
            let table = new Table({
                head: ['Bot ID', 'Bot Name', 'Version', 'Description']
                , colWidths: [20, 20, 10, 20]
            });
            data.items.forEach((bot: { id: string, name: string, version: string, desc: string }) => {
                table.push([bot.id, bot.name, bot.version, bot.desc]);
            });
            console.log(table.toString());
        } catch (e) {
            this.helper.wrapError(e);
        }
    }

    async update(options: JsonObject) {
        let desc = this.helper.loadYaml("./bot.yml");

        let [major, minor, patch] = (<string>desc.version).split(".").map((val: string) => parseInt(val));

        switch (options.rev) {
            case "major":
                ++major;
                minor = 0;
                patch = 0;
                break;
            case "minor":
                ++minor;
                patch = 0;
                break;
            case "patch":
                ++patch;
                break;
        }

        desc.version = `${major}.${minor}.${patch}`;
        desc.tag = options.tag || null;

        let bot = Config.create(desc, { left: "${", right: "}" });
        bot = this.compile.execDirectives(bot, process.cwd());
        bot.resolve();

        let botDesc = bot.get();
        botDesc.name = botDesc.name || "bot";

        if (!botDesc.id) {
            let id = uuid();
            botDesc.id = id;
            desc.id = id;

            try {
                let result = await this.helper.toPromise(this.api.botApi, this.api.botApi.botsPost, botDesc);
                console.log("BOT CREATED");
            }
            catch (e) {
                let errorMessage;

                if (e.response && e.response.body && e.response.body.message)
                    errorMessage = e.response.body.message;
                else
                    errorMessage = e.message;

                console.log(errorMessage);
            }
        }
        else {
            try {
                let result = await this.helper.toPromise(this.api.botApi, this.api.botApi.botsBotIdPut, botDesc.id, botDesc, {});

                desc.version = result.data.version;

                console.log("UPDATED BOT SUCCESSFULLY");
            } catch (e) {
                let errorMessage;

                if (e.response && e.response.body && e.response.body.message)
                    errorMessage = e.response.body.message;
                else
                    errorMessage = e.message;

                if (errorMessage === "Bot not found.") {
                    let result = await this.helper.toPromise(this.api.botApi, this.api.botApi.botsPost, botDesc);

                    desc.version = result.data.version;
                    console.log("CREATED BOT SUCCESSFULLY");
                }
                else {
                    console.log(errorMessage);
                }
            }
        }

        this.helper.dumpYaml("./bot.yml", desc);
    }

    async delete(options: JsonObject) {
        let answer = await this.helper.inquirerPrompt([
            {
                type: "confirm",
                name: "confirmation",
                message: "Are you sure to delete this bot?",
                default: false
            }
        ]);

        if (!answer.confirmation)
            return;

        let botId = this.helper.getBotId();

        try {
            let { data } = await this.helper.toPromise(this.api.botApi, this.api.botApi.botsBotIdDelete, botId);

            console.log("REMOVE BOT SUCCESSFULLY");
        } catch (e) {
            this.helper.wrapError(e);
        }
    }

    console(options: JsonObject) {
        let currentSession = <string>(options.session ? options.session : uuid());
        let botDesc = this.helper.loadYaml("./bot.yml");
        let botId = botDesc.id;
        let defaultDeploymentId = "f223c9e0-6ba1-434d-8313-a9f18ca364bd";

        let con = repl.start({
            prompt: botDesc.name + ">",
            writer: function (obj: any) {
                return util.inspect(obj, false, null, true);
            }
        });

        con.context.text = function text(str: string) {
            let message = {
                type: "text",
                content: str
            };
            let body = {
                sessionId: currentSession,
                message
            }

            try {
                let { data } = this.sync(this.helper.toPromise(this.api.botApi, this.api.botApi.botsBotIdConversePost, botId, body));

                return data;
            } catch (e) {
                if (e.response && e.response.body && e.response.body.message)
                    return e.response.body.message;
                else
                    return e.message;
            }
        }.bind(this);

        con.context.button = function button(op: JsonObject, obj: JsonObject = {}) {
            obj.op = op;
            let message = {
                type: "data",
                payload: obj
            };
            let body = {
                sessionId: currentSession,
                message
            }

            try {
                let { data } = this.sync(this.helper.toPromise(this.api.botApi, this.api.botApi.botsBotIdConversePost, botId, body));

                return data;
            } catch (e) {
                if (e.response && e.response.body && e.response.body.message)
                    return e.response.body.message;
                else
                    return e.message;
            }
        }.bind(this);

        con.context.command = function button(command: string, obj: JsonObject = {}) {
            let message = {
                type: "command",
                content: command,
                payload: obj
            };
            let body = {
                sessionId: currentSession,
                message
            }

            try {
                let { data } = this.sync(this.helper.toPromise(this.api.botApi, this.api.botApi.botsBotIdConversePost, botId, body));

                return data;
            } catch (e) {
                if (e.response && e.response.body && e.response.body.message)
                    return e.response.body.message;
                else
                    return e.message;
            }
        }.bind(this);

        con.context.current = function (session: string) {
            if (arguments.length)
                currentSession = session;
            else
                return currentSession;
        }.bind(this);

        con.context.session = function session(name: string, update: JsonObject) {
            try {
                if (!arguments.length) {
                    let res = this.sync(this.helper.toPromise(this.api.sessionApi, this.api.sessionApi.botsBotIdDeploymentsDeploymentIdSessionsSessionIdGet, botId, defaultDeploymentId, currentSession, "get"));

                    return res.data;
                } else if (arguments.length == 1) {
                    let res = this.sync(this.helper.toPromise(this.api.sessionApi, this.api.sessionApi.botsBotIdDeploymentsDeploymentIdSessionsSessionIdGet, botId, defaultDeploymentId, name, "get"));

                    return res.data;
                } else {
                    let res = this.sync(this.helper.toPromise(this.api.sessionApi, this.api.sessionApi.botsBotIdDeploymentsDeploymentIdSessionsSessionIdGet, botId, defaultDeploymentId, currentSession, "getOrCreate"));
                    let session = res.data;
                    res = this.sync(this.helper.toPromise(this.api.sessionApi, this.api.sessionApi.botsBotIdDeploymentsDeploymentIdSessionsSessionIdPut, botId, defaultDeploymentId, session.id, update));

                    return res.data;
                }
            } catch (e) {
                if (e.response && e.response.body && e.response.body.message)
                    return e.response.body.message;
                else
                    return e.message;
            }
        }.bind(this);

        con.context.clear = function clear(name: string) {
            name = name || currentSession;

            try {
                let { data } = this.sync(this.helper.toPromise(this.api.sessionApi, this.api.sessionApi.botsBotIdDeploymentsDeploymentIdSessionsSessionIdGet, botId, defaultDeploymentId, name, "get"));
                let session = { ...data };

                if (session)
                    this.sync(this.helper.toPromise(this.api.sessionApi, this.api.sessionApi.botsBotIdDeploymentsDeploymentIdSessionsSessionIdDelete, botId, defaultDeploymentId, session.id));
            } catch (e) {
                let errorMessage;

                if (e.response && e.response.body && e.response.body.message)
                    errorMessage = e.response.body.message;
                else
                    errorMessage = e.message;

                if (errorMessage == "Session not found.") {
                    return;
                }

                return errorMessage;
            }
        }.bind(this);

        con.context.clearCaches = function clearCaches(num: number = 20) {
            try {
                for (let i = 0; i < num; i++) {
                    this.sync(this.helper.toPromise(this.api.cachesApi, this.api.cachesApi.cachesDelete));
                }
            } catch (e) {
                if (e.response && e.response.body && e.response.body.message)
                    return e.response.body.message;
                else
                    return e.message;
            }
        }.bind(this);
    }

    private sync(promise: any) {
        if (promise && typeof promise.then == "function") {
            let done = false;
            let error: Error = null;
            let result;

            promise.then((res: any) => {
                done = true;
                result = res;
            }).catch((e: Error) => {
                error = e;
            });

            deasync.loopWhile(() => {
                return !done && !error;
            });

            if (error)
                throw error;

            return result;
        }


        throw new Error("Sync only accept promises");
    }
}