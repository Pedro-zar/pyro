/**
 * Condições mentais do elemento Mente (SRD Magia).
 *
 * Mente é o único elemento cujo efeito não cabe num botão: o mago escolhe
 * quais das sete condições aplicar e por quanto tempo, gastando os pontos que
 * a Intenção comprou. Um botão por condição no card daria sete botões sem
 * dizer quanto ainda sobra para gastar.
 *
 * Quem escolhe é o conjurador; quem resiste é o alvo. A janela fecha mandando
 * um card com a escolha, e é de lá que cada alvo rola SAB contra a DT e, se
 * falhar, recebe o que foi escolhido (ver mente.mjs).
 *
 * Cada condição dá desvantagem nos testes do atributo dela e traz a proibição
 * própria da emoção (ver PYRO.condicoesMentais e condicoes.mjs).
 */
import { listaDeCondicoesMentais } from "../condicoes.mjs";
import { cardDeConjuracaoMental } from "../mente.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MenteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor = null, alvos = [], pontos = 1, dt = 0, resistencias = [],
                ...options } = {}) {
    super(options);
    /** Quem conjurou: o card da escolha sai em nome dele. */
    this.actor = actor;
    this.alvos = alvos;
    /** Com o que o alvo resiste, vindo da magia (ver MagiaData.resistencias). */
    this.resistencias = resistencias;
    /** Pontos que a Intenção das runas de Mente comprou. */
    this.pontos = Math.max(1, pontos);
    this.dt = dt;
    /** Turnos escolhidos por condição; 0 é condição não aplicada. */
    this.turnos = {};
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-mente-{id}",
    classes: ["pyro", "conjurador", "mente"],
    tag: "form",
    position: { width: 520, height: "auto" },
    window: { title: "PYRO.Mente.Titulo", resizable: true },
    form: { handler: MenteApp.#aoConjurar, closeOnSubmit: false },
    actions: {
      subirTurnos: MenteApp.#subirTurnos,
      descerTurnos: MenteApp.#descerTurnos,
      limpar: MenteApp.#limpar
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/mente.hbs") }
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Uma condição custa 1 ponto para entrar, e cada turno a mais custa outro:
   * aplicar duas condições por 1 turno custa o mesmo que uma por 2 turnos,
   * que é o que a regra descreve.
   */
  #gasto() {
    return Object.values(this.turnos).reduce((total, t) => total + Math.max(0, t), 0);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const gasto = this.#gasto();

    const condicoes = listaDeCondicoesMentais().map(c => ({
      ...c,
      turnos: this.turnos[c.chave] ?? 0,
      // Sem ponto sobrando, o botão de subir para de oferecer o que não há.
      podeSubir: gasto < this.pontos
    }));

    this._podeConjurar = gasto > 0 && this.alvos.length > 0;

    Object.assign(context, {
      condicoes,
      pontos: this.pontos,
      gasto,
      restam: this.pontos - gasto,
      alvos: this.alvos.map(a => a.name).join(", "),
      semAlvos: !this.alvos.length,
      dtTexto: this.dt ? game.i18n.format("PYRO.Magia.DT", { valor: this.dt }) : "",
      podeConjurar: this._podeConjurar
    });
    return context;
  }

  static #subirTurnos(event, target) {
    const chave = target.dataset.chave;
    if (this.#gasto() >= this.pontos) return;
    this.turnos[chave] = (this.turnos[chave] ?? 0) + 1;
    this.render();
  }

  static #descerTurnos(event, target) {
    const chave = target.dataset.chave;
    this.turnos[chave] = Math.max(0, (this.turnos[chave] ?? 0) - 1);
    this.render();
  }

  static #limpar() {
    this.turnos = {};
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const botao = this.element.querySelector("button[type=submit]");
    if (botao) botao.disabled = !this._podeConjurar;
  }

  static async #aoConjurar() {
    if (!this._podeConjurar) return;
    /*
     * A escolha vai para o card, e não para as fichas: quem decide é o
     * conjurador, mas quem recebe a condição é o alvo, depois de falhar o
     * teste dele. Aqui nada é aplicado.
     */
    const condicoes = Object.entries(this.turnos)
      .filter(([, t]) => t > 0)
      .map(([chave, turnos]) => ({ chave, turnos }));

    await cardDeConjuracaoMental(this.actor, {
      condicoes, dt: this.dt, alvos: this.alvos, resistencias: this.resistencias
    });
    return this.close();
  }
}
