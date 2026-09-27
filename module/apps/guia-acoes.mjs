import { PYRO } from "../config.mjs";
import { caminho } from "../sistema.mjs";
import { fazerAcaoDoGuia } from "../economia.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Lembrete das ações do SRD §5, com custo e resumo de cada uma. Aberto pela
 * ficha, cada linha com custo fixo vira um botão: o clique cobra do contador
 * do turno e avisa a mesa no chat.
 */
export class GuiaAcoesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor = null, ...options } = {}) {
    super(options);
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-guia-acoes-{id}",
    classes: ["pyro", "guia-acoes"],
    position: { width: 460, height: 560 },
    window: { title: "PYRO.GuiaAcoes.Titulo", resizable: true },
    actions: {
      fazerAcao: GuiaAcoesApp.#fazerAcao
    }
  };

  static PARTS = {
    lista: { template: caminho("templates/apps/guia-acoes.hbs") }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const podeFazer = !!this.actor?.isOwner;
    context.acoes = PYRO.guiaAcoes.map(chave => ({
      chave,
      nome: game.i18n.localize(`PYRO.Guia.${chave}.Nome`),
      custo: game.i18n.localize(`PYRO.Guia.${chave}.Custo`),
      desc: game.i18n.localize(`PYRO.Guia.${chave}.Desc`),
      clicavel: podeFazer && !!PYRO.acoesDoGuia[chave]
    }));
    const eco = this.actor?.economia;
    context.contador = eco?.rastreia
      ? game.i18n.format("PYRO.Economia.Restam", {
          resta: eco.disponivel, max: eco.max,
          unidade: game.i18n.localize(eco.modo === "reacoes" ? "PYRO.Economia.Reacoes" : "PYRO.Economia.Acoes")
        })
      : "";
    return context;
  }

  /** Enter e espaço nas linhas clicáveis, como num botão de verdade. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    for (const linha of this.element.querySelectorAll(".guia-acao.clicavel")) {
      linha.addEventListener("keydown", evento => {
        if (evento.key !== "Enter" && evento.key !== " ") return;
        evento.preventDefault();
        linha.click();
      });
    }
  }

  static async #fazerAcao(event, target) {
    await fazerAcaoDoGuia(this.actor, target.dataset.chave);
    // O contador do topo acompanha o que acabou de sair.
    if (this.rendered) this.render();
  }
}
