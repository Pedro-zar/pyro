/**
 * Executor de técnicas: o Esforço posto em cada traço, com a estamina e o
 * limite seguro à vista antes de executar.
 *
 * É o irmão do Conjurador. A ideia é a mesma: o preço e o risco aparecem
 * enquanto o jogador decide, e não depois no card do chat.
 */
import { PYRO } from "../config.mjs";
import {
  tracosDaTecnica, calcularEsforco, ataquesDaTecnica, usarTecnica, textoDoTraco, textoDaCondicao,
  resumoDaTecnica, numeroDoTraco
} from "../tecnica.mjs";
import { pintarTema } from "../tema.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Piso do Esforço, igual ao da Intenção nas magias: um traço com Esforço 0 não
 * rende nada, e a técnica que sai com todos zerados não faz coisa alguma.
 */
const ESFORCO_MINIMO = 1;

export class ExecutorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, item, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.item = item;
    /** Esforço por chave de traço, escolhido nesta execução. */
    this.esforcos = Object.fromEntries(
      tracosDaTecnica(item.system).map(t => [t.chave, ESFORCO_MINIMO])
    );
    this.ataqueId = null;
  }

  get title() {
    return game.i18n.format("PYRO.Executor.Titulo", { nome: this.item.name });
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-executor-{id}",
    classes: ["pyro", "conjurador", "executor"],
    tag: "form",
    position: { width: 860, height: "auto" },
    window: { title: "PYRO.Executor.Nome", resizable: true },
    form: { handler: ExecutorApp.#aoExecutar, closeOnSubmit: false },
    actions: {
      subirEsforco: ExecutorApp.#subirEsforco,
      descerEsforco: ExecutorApp.#descerEsforco,
      zerarEsforcos: ExecutorApp.#zerarEsforcos
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/executor.hbs") }
  };

  /* ---------------------------------------------------------------------- */

  #usados() {
    return tracosDaTecnica(this.item.system)
      .map(t => ({ ...t, esforco: Math.max(ESFORCO_MINIMO, this.esforcos[t.chave] ?? 0) }));
  }

  /**
   * A coluna da direita: o ataque como ele vai sair, com o dano da arma já
   * multiplicado e uma linha por característica.
   *
   * Sai do mesmo calc que a execução usa, e não de uma segunda conta: se um
   * traço estiver rendendo o número errado, é aqui que aparece antes de virar
   * uma rolagem no chat.
   */
  #previa(calc, ataque) {
    const loc = k => game.i18n.localize(k);
    const resumo = resumoDaTecnica(this.actor, this.item, calc, ataque);
    const linhas = [];

    // O multiplicador em si, além do dano já multiplicado: é o que diz se a
    // Potência fechou mais um dado ou parou no meio do caminho.
    if (resumo.mult !== 1) {
      linhas.push({
        nome: loc("PYRO.Previa.Multiplicador"),
        texto: `${numeroDoTraco(resumo.mult)}x`,
        origens: ataque ? ataque.nome : ""
      });
    }
    if (ataque?.alcanceMaximo > 0) {
      linhas.push({
        nome: loc("PYRO.Item.Alcance"),
        texto: game.i18n.format("PYRO.Previa.AlcanceArma",
          { menor: ataque.alcanceMenor, maximo: ataque.alcanceMaximo }),
        origens: ataque.nome
      });
    }
    linhas.push(...resumo.caracteristicas.map(c => ({ ...c, origens: "" })));

    return {
      titulo: loc("PYRO.Previa.Tecnica"),
      dano: resumo.dano.map(d => ({ rotulo: d.rotulo, texto: d.formula, origens: ataque?.nome ?? "" })),
      linhas,
      temAlgo: resumo.dano.length > 0 || linhas.length > 0,
      vazio: loc("PYRO.Previa.VaziaTecnica")
    };
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.item.system;
    const base = PYRO.acoesBaseTecnica[sys.acaoBase];
    const estamina = this.actor.system.recursos.estamina;
    const loc = k => game.i18n.localize(k);

    const usados = this.#usados();
    const calc = calcularEsforco(this.actor, usados);
    // Todo traço entra na conta, porque o Esforço mínimo é 1: cada linha da
    // janela tem a sua em calc.
    const fichas = calc.linhas.map(l => ({
      chave: l.chave,
      nome: loc(l.cfg.label ?? l.chave),
      grupo: loc(`PYRO.Tecnica.Grupo.${l.cfg.grupo}`),
      grau: l.grau,
      esforco: l.esforco,
      custo: l.custo,
      alem: l.alem,
      efeito: textoDoTraco(l)
    }));

    /* --- Ataque: a técnica pergunta sempre, entre os que a condição aceita -- */
    const ataques = base?.ataca ? ataquesDaTecnica(this.actor, sys) : [];
    // Um ataque só continua sendo uma escolha: o jogador confere qual arma a
    // técnica vai usar antes de gastar estamina.
    if (base?.ataca && !ataques.some(a => a.id === this.ataqueId)) {
      this.ataqueId = ataques[0]?.id ?? null;
    }

    /*
     * O ônus "custa PV" cobra vida além da estamina, e o que falta de estamina
     * também sai do PV: os dois disputam a mesma reserva, e a conta precisa
     * ser feita junta para o botão não liberar uma execução que mata o ator.
     */
    const pv = this.actor.system.recursos.pv.value;
    const custaPv = (sys.onus ?? []).some(o => PYRO.onusTecnica[o]?.regra === "custaPv");
    const pvDoOnus = custaPv ? calc.somaEsforcos : 0;
    const faltaEstamina = calc.estamina + pvDoOnus > estamina.value + pv;
    const semAtaque = !!base?.ataca && !ataques.length;
    this._podeExecutar = !semAtaque && !faltaEstamina;

    Object.assign(context, {
      actor: this.actor,
      item: this.item,
      previa: this.#previa(calc, ataques.find(a => a.id === this.ataqueId) ?? null),
      fichas,
      temTracos: fichas.length > 0,
      pedeAtaque: !!base?.ataca,
      semAtaque,
      ataques: ataques.map(a => ({ id: a.id, nome: a.nome, ativo: a.id === this.ataqueId })),
      condicao: textoDaCondicao(sys),

      estaminaAtual: estamina.value,
      estaminaMax: estamina.max,
      custoTotal: calc.estamina,
      restante: estamina.value - calc.estamina,
      pctUsada: estamina.max > 0 ? Math.clamp((estamina.value / estamina.max) * 100, 0, 100) : 0,
      pctCusto: estamina.max > 0 ? Math.clamp((calc.estamina / estamina.max) * 100, 0, 100) : 0,
      faltaEstamina,

      limite: calc.limite,
      limiteTexto: game.i18n.format("PYRO.Executor.Limite", { n: calc.limite }),
      excesso: calc.excesso,
      excessoTexto: calc.excesso > 0
        ? game.i18n.format("PYRO.Executor.Excesso", { excesso: calc.excesso, nd: calc.nd })
        : "",
      acoesTexto: game.i18n.format(
        base?.reacao ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes", { acoes: sys.acoes }),
      baseTexto: loc(base?.label ?? ""),
      podeExecutar: this._podeExecutar
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /** Guarda o ataque escolhido antes de re-renderizar por causa do Esforço. */
  #capturarCampos() {
    const escolhido = this.element?.querySelector("[name=ataque]")?.value;
    if (escolhido) this.ataqueId = escolhido;
  }

  static #subirEsforco(event, target) {
    this.#capturarCampos();
    const chave = target.dataset.chave;
    this.esforcos[chave] = Math.max(ESFORCO_MINIMO, this.esforcos[chave] ?? 0) + 1;
    this.render();
  }

  /*
   * O piso é 1, como a Intenção das magias: um traço sem Esforço não rende
   * nada, e deixar zerar dava uma execução que não fazia coisa nenhuma.
   */
  static #descerEsforco(event, target) {
    this.#capturarCampos();
    const chave = target.dataset.chave;
    this.esforcos[chave] = Math.max(ESFORCO_MINIMO, (this.esforcos[chave] ?? 0) - 1);
    this.render();
  }

  static #zerarEsforcos() {
    this.#capturarCampos();
    for (const chave of Object.keys(this.esforcos)) this.esforcos[chave] = ESFORCO_MINIMO;
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor);
    const botao = this.element.querySelector("button[type=submit]");
    if (botao) botao.disabled = !this._podeExecutar;
  }

  static async #aoExecutar(event, form, formData) {
    this.#capturarCampos();
    if (!this._podeExecutar) return;
    await usarTecnica(this.actor, this.item, {
      esforcos: this.esforcos,
      ataqueId: this.ataqueId
    });
    return this.close();
  }
}
