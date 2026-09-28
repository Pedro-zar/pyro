/**
 * Janela de uma habilidade escalável: os pontos de cada escalamento, o custo
 * em cada recurso e o limite seguro à vista antes de usar.
 *
 * É a mesma janela do Executor de técnicas, com a conta vinda da habilidade
 * (ver escala.mjs): o preço e o risco aparecem enquanto o jogador decide.
 */
import { PYRO } from "../config.mjs";
import {
  calcularEscala, usarEscala, rotuloDosPontos, nomeDoRecurso, PONTOS_MINIMOS
} from "../escala.mjs";
import { ajustesDeCusto, custoAjustado } from "../efeitos.mjs";
import { pintarTema } from "../tema.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EscalaApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, item, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.item = item;
    /** Pontos por índice de escalamento, escolhidos neste uso. */
    this.pontos = {};
  }

  get title() {
    return game.i18n.format("PYRO.Escala.Titulo", { nome: this.item.name });
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-escala-{id}",
    classes: ["pyro", "conjurador", "executor", "escala"],
    tag: "form",
    position: { width: 860, height: "auto" },
    window: { title: "PYRO.Escala.Nome", resizable: true },
    form: { handler: EscalaApp.#aoUsar, closeOnSubmit: false },
    actions: {
      subirPonto: EscalaApp.#subirPonto,
      descerPonto: EscalaApp.#descerPonto,
      zerarPontos: EscalaApp.#zerarPontos
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/escala.hbs") }
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Cada recurso cobrado, com o que o personagem tem. Estamina pode faltar:
   * o que falta dela sai dos PV, como em qualquer custo, e a conta só trava
   * quando nem os dois juntos pagam.
   */
  #medidores(calc) {
    const recursos = this.actor.system.recursos ?? {};
    const pv = Number(recursos.pv?.value) || 0;
    return Object.entries(calc.custos).map(([chave, custo]) => {
      const atual = Number(recursos[chave]?.value) || 0;
      const max = Number(recursos[chave]?.max) || 0;
      const falta = chave === "estamina" ? custo > atual + pv : custo > atual;
      return {
        chave,
        // A cor do recurso na ficha; os de raça dividem uma cor só.
        cor: ["estamina", "mana", "energia", "vontade"].includes(chave)
          ? `var(--pyro-${chave})` : "var(--pyro-recurso-custom)",
        nome: nomeDoRecurso(chave),
        custo,
        atual,
        falta,
        restante: atual - custo,
        pctUsada: max > 0 ? Math.clamp((atual / max) * 100, 0, 100) : 0,
        pctCusto: max > 0 ? Math.clamp((custo / max) * 100, 0, 100) : 0
      };
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.item.system;
    const calc = calcularEscala(this.item, this.pontos);
    const rotulo = rotuloDosPontos(this.item);
    const medidores = this.#medidores(calc);
    const faltaRecurso = medidores.some(m => m.falta);
    this._podeUsar = calc.linhas.length > 0 && !faltaRecurso;

    const tipo = sys.tipoCusto === "reacao" ? "reacao" : "acao";
    const acoes = custoAjustado(sys.custoAcoes, ajustesDeCusto(this.actor, this.item).acoes);

    Object.assign(context, {
      actor: this.actor,
      item: this.item,
      rotulo,
      acoesTexto: acoes
        ? game.i18n.format(tipo === "reacao" ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes", { acoes })
        : "",
      fichas: calc.linhas.map(l => ({
        indice: l.indice,
        nome: l.nome,
        pontos: l.pontos,
        efeito: l.texto,
        alem: l.alem,
        custo: Object.entries(l.custos)
          .map(([chave, valor]) => `${valor} ${nomeDoRecurso(chave)}`).join(" · ")
      })),
      temEscalamentos: calc.linhas.length > 0,
      medidores,
      semCusto: medidores.length === 0,
      faltaRecurso,
      temLimite: calc.limite !== null,
      limite: calc.limite,
      excesso: calc.excesso,
      excessoTexto: calc.excesso > 0
        ? game.i18n.format("PYRO.Escala.Excesso", { excesso: calc.excesso, nd: calc.nd })
        : "",
      previa: {
        titulo: game.i18n.localize("PYRO.Escala.Previa"),
        dano: calc.linhas
          .filter(l => Number(l.cfg.faces) > 0)
          .map(l => ({ rotulo: l.nome, texto: l.texto, origens: "" })),
        linhas: calc.linhas
          .filter(l => !(Number(l.cfg.faces) > 0))
          .map(l => ({ nome: l.nome, texto: l.texto, origens: "" })),
        temAlgo: calc.linhas.length > 0,
        vazio: game.i18n.localize("PYRO.Escala.SemEscalamentos")
      },
      podeUsar: this._podeUsar
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */

  #mudar(indice, delta) {
    const atual = Math.max(PONTOS_MINIMOS, Number(this.pontos[indice]) || PONTOS_MINIMOS);
    this.pontos[indice] = Math.max(PONTOS_MINIMOS, atual + delta);
    this.render();
  }

  static #subirPonto(event, target) {
    this.#mudar(Number(target.dataset.indice), 1);
  }

  static #descerPonto(event, target) {
    this.#mudar(Number(target.dataset.indice), -1);
  }

  static #zerarPontos() {
    this.pontos = {};
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor);
    const botao = this.element.querySelector("button[type=submit]");
    if (botao) botao.disabled = !this._podeUsar;
  }

  static async #aoUsar() {
    // Um segundo clique enquanto o primeiro cobra sairia em dobro no chat.
    if (!this._podeUsar || this._usando) return;
    this._usando = true;
    try {
      // Só fecha se a habilidade saiu: faltando ação ou recurso, os pontos
      // escolhidos ficam na janela.
      const saiu = await usarEscala(this.actor, this.item, this.pontos);
      if (saiu) await this.close();
    } finally {
      this._usando = false;
    }
  }
}

/** Abre a janela de uma habilidade escalável. */
export function abrirEscala(actor, item) {
  if (actor && !actor.podeAgir()) return;
  return new EscalaApp({ actor, item }).render(true);
}

/** Opções da ficha da habilidade: recursos que um custo pode cobrar. */
export function opcoesDeRecurso() {
  return Object.fromEntries(PYRO.recursosDeGasto().map(chave => [chave, nomeDoRecurso(chave)]));
}
