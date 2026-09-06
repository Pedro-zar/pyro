import { PYRO } from "../config.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Lembrete rápido das ações do SRD §5, com custo e resumo de cada uma. */
export class GuiaAcoesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-guia-acoes",
    classes: ["pyro", "guia-acoes"],
    position: { width: 460, height: 560 },
    window: { title: "PYRO.GuiaAcoes.Titulo", resizable: true }
  };

  static PARTS = {
    lista: { template: caminho("templates/apps/guia-acoes.hbs") }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.acoes = PYRO.guiaAcoes.map(chave => ({
      nome: game.i18n.localize(`PYRO.Guia.${chave}.Nome`),
      custo: game.i18n.localize(`PYRO.Guia.${chave}.Custo`),
      desc: game.i18n.localize(`PYRO.Guia.${chave}.Desc`)
    }));
    return context;
  }
}
