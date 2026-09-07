/**
 * Condições mentais do elemento Mente (SRD Magia).
 *
 * Mente é o único elemento cujo efeito não cabe num botão: o mago escolhe
 * quais das sete condições aplicar e por quanto tempo, gastando os pontos que
 * a Intenção comprou. Um botão por condição no card daria sete botões sem
 * dizer quanto ainda sobra para gastar.
 *
 * As condições ainda não descontam nada — cada uma aponta o atributo que vai
 * pesar quando a mesa fechar a regra (ver PYRO.condicoesMentais).
 */
import { PYRO } from "../config.mjs";
import { esc } from "../ui.mjs";
import { listaDeCondicoesMentais, aplicarCondicaoMental } from "../condicoes.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MenteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ alvos = [], pontos = 1, dt = 0, ...options } = {}) {
    super(options);
    this.alvos = alvos;
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
    form: { handler: MenteApp.#aoAplicar, closeOnSubmit: false },
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

    this._podeAplicar = gasto > 0 && this.alvos.length > 0;

    Object.assign(context, {
      condicoes,
      pontos: this.pontos,
      gasto,
      restam: this.pontos - gasto,
      alvos: this.alvos.map(a => a.name).join(", "),
      semAlvos: !this.alvos.length,
      dtTexto: this.dt ? game.i18n.format("PYRO.Magia.DT", { valor: this.dt }) : "",
      podeAplicar: this._podeAplicar
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
    if (botao) botao.disabled = !this._podeAplicar;
  }

  static async #aoAplicar() {
    if (!this._podeAplicar) return;
    const escolhidas = Object.entries(this.turnos).filter(([, t]) => t > 0);
    const relatos = [];

    for (const actor of this.alvos) {
      if (!actor.isOwner) {
        ui.notifications.warn(game.i18n.format("PYRO.Avisos.SemPermissao", { nome: actor.name }));
        continue;
      }
      const nomes = [];
      for (const [chave, turnos] of escolhidas) {
        await aplicarCondicaoMental(actor, chave, turnos);
        nomes.push(game.i18n.format("PYRO.Mente.Linha", {
          condicao: game.i18n.localize(PYRO.condicoes[chave]?.label ?? chave), turnos
        }));
      }
      if (nomes.length) {
        relatos.push(`<li><strong>${esc(actor.name)}</strong>: ${nomes.join(", ")}</li>`);
      }
    }

    if (relatos.length) {
      await ChatMessage.create({
        content: `<div class="pyro-chat pyro-mente-card">
          <p><strong>${game.i18n.localize("PYRO.Mente.Titulo")}</strong></p>
          <ul>${relatos.join("")}</ul>
          ${this.dt ? `<p class="pyro-nota">${game.i18n.format("PYRO.Mente.Resistir", { dt: this.dt })}</p>` : ""}
        </div>`
      });
    }
    return this.close();
  }
}
