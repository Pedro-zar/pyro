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
  resumoDaTecnica, numeroDoTraco, posturaAtivaVale, posturaExigida, acoesDaExecucao,
  esforcoMinimo, reacaoDaTecnica, municoesDoAtor
} from "../tecnica.mjs";
import { ajustesDeCusto, custoAjustado, textoDeAlcance } from "../efeitos.mjs";
import { acoesComConfusao, regraMental } from "../condicoes.mjs";
import { camposDaReacao, ligarCamposDeDano } from "../reacao.mjs";
import { pintarTema } from "../tema.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Partes que mudam com o Esforço, a arma e a munição. A da reação não entra. */
const PARTES_DO_ESFORCO = ["form", "rodape"];

export class ExecutorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {string} [options.ataqueId] arma que abre escolhida (o clique na
   *   arma abre o Atacar já com ela).
   */
  constructor({ actor, item, ataqueId = null, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.item = item;
    /** Piso do Esforço desta técnica: 0 na básica, 1 nas outras. */
    this.minimo = esforcoMinimo(item.system);
    /** Esforço por chave de traço, escolhido nesta execução. */
    this.esforcos = Object.fromEntries(
      tracosDaTecnica(item.system).map(t => [t.chave, this.minimo])
    );
    this.ataqueId = ataqueId;
    this.municaoId = null;
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

  /*
   * Três partes, para o Esforço poder redesenhar a janela sem apagar o que o
   * jogador já escreveu na reação: o dano que chega, os bônus e a Força de
   * Vontade ficam numa parte que só desenha na abertura.
   */
  static PARTS = {
    reacao: { template: caminho("templates/apps/executor-reacao.hbs") },
    form: { template: caminho("templates/apps/executor.hbs") },
    rodape: { template: caminho("templates/apps/executor-rodape.hbs") }
  };

  /** A parte da reação só existe na técnica de reação. */
  _configureRenderParts(options) {
    const partes = super._configureRenderParts(options);
    if (!reacaoDaTecnica(this.item.system)) delete partes.reacao;
    return partes;
  }

  /* ---------------------------------------------------------------------- */

  #usados() {
    return tracosDaTecnica(this.item.system)
      .map(t => ({ ...t, esforco: Math.max(this.minimo, this.esforcos[t.chave] ?? 0) }));
  }

  /**
   * A coluna da direita: o ataque como ele vai sair, com as fórmulas cruas,
   * o multiplicador do total e uma linha por característica.
   *
   * Sai do mesmo calc que a execução usa, e não de uma segunda conta: se um
   * traço estiver rendendo o número errado, é aqui que aparece antes de virar
   * uma rolagem no chat.
   */
  #previa(calc, ataque) {
    const loc = k => game.i18n.localize(k);
    const resumo = resumoDaTecnica(this.actor, this.item, calc, ataque);
    const linhas = [];

    // O multiplicador do total: a Potência não mexe nos dados, o produto
    // final é floor(total rolado x este número x mults de efeito).
    if (resumo.mult !== 1) {
      linhas.push({
        nome: loc("PYRO.Previa.Multiplicador"),
        texto: `${numeroDoTraco(resumo.mult)}x`,
        origens: ataque ? ataque.nome : ""
      });
    }
    /*
     * Alcance da arma: a linha aparece quando o golpe tem distância a
     * anunciar — a arma é de tiro, ou um efeito esticou o corpo a corpo e o
     * jogador precisa ver até onde ele chega agora.
     */
    if (ataque && (ataque.alcanceMaximo > 0 || ataque.alcance.mudou)) {
      linhas.push({
        nome: loc("PYRO.Item.Alcance"),
        texto: textoDeAlcance(ataque.alcance),
        origens: [ataque.nome, ...ataque.alcance.nomes].join(", ")
      });
    }
    linhas.push(...resumo.caracteristicas.map(c => ({ ...c, origens: c.origens ?? "" })));

    return {
      titulo: loc("PYRO.Previa.Tecnica"),
      dano: resumo.dano.map(d => ({ rotulo: d.rotulo, texto: d.formula, origens: ataque?.nome ?? "" })),
      linhas,
      temAlgo: resumo.dano.length > 0 || linhas.length > 0,
      vazio: loc("PYRO.Previa.VaziaTecnica")
    };
  }

  /**
   * O mesmo custo que usarTecnica cobra: da arma escolhida quando a técnica
   * aceita várias, com os efeitos, e com a ação da confusão só em ação — a
   * reação continua custando o que custava, como no card.
   */
  #custoEmAcoes(sys, base, ataque) {
    const ajustado = custoAjustado(acoesDaExecucao(sys, ataque),
      ajustesDeCusto(this.actor, [this.item, ataque?.item]).acoes);
    return base?.reacao ? ajustado : acoesComConfusao(this.actor, ajustado);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.item.system;
    const base = PYRO.acoesBaseTecnica[sys.acaoBase];
    const estamina = this.actor.system.recursos.estamina;
    const loc = k => game.i18n.localize(k);

    /* --- Ataque: a técnica pergunta sempre, entre os que a condição aceita -- */
    const ataques = base?.ataca ? ataquesDaTecnica(this.actor, sys, this.item) : [];
    // Um ataque só continua sendo uma escolha: o jogador confere qual arma a
    // técnica vai usar antes de gastar estamina.
    if (base?.ataca && !ataques.some(a => a.id === this.ataqueId)) {
      this.ataqueId = ataques[0]?.id ?? null;
    }
    const ataque = ataques.find(a => a.id === this.ataqueId) ?? null;

    /* --- Munição: a arma que dispara escolhe o que gasta, aqui mesmo ------- */
    const pedeMunicao = !!ataque?.item?.system.usaMunicao;
    const municoes = pedeMunicao ? municoesDoAtor(this.actor) : [];
    if (pedeMunicao && !municoes.some(m => m.id === this.municaoId)) {
      this.municaoId = municoes[0]?.id ?? null;
    }
    const semMunicao = pedeMunicao && !municoes.length;

    /* --- Reação: os campos da janela de esquiva ou bloqueio, aqui dentro --- */
    const reacao = reacaoDaTecnica(sys);

    const usados = this.#usados();
    // A arma entra na conta junto da técnica: efeitos de custo presos a ela
    // valem aqui, e a janela precisa mostrar a mesma estamina que usarTecnica
    // vai cobrar.
    const calc = calcularEsforco(this.actor, usados, [this.item, ataque?.item]);
    // Todo traço entra na conta, mesmo o que está em Esforço 0 numa básica:
    // cada linha da janela tem a sua em calc.
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
    // A guarda pode cair com a janela aberta: o botão desliga junto.
    const foraDePostura = !posturaAtivaVale(this.actor, sys);
    this._podeExecutar = !semAtaque && !semMunicao && !faltaEstamina && !foraDePostura;

    Object.assign(context, {
      actor: this.actor,
      item: this.item,
      // A mesma frase que o aviso do chat usa quando a técnica é barrada.
      avisoPostura: foraDePostura
        ? game.i18n.format("PYRO.Tecnica.ExigePostura",
            { nome: posturaExigida(this.actor, sys)?.name ?? "" })
        : null,
      previa: this.#previa(calc, ataque),
      fichas,
      temTracos: fichas.length > 0,
      pedeAtaque: !!base?.ataca,
      semAtaque,
      ataques: ataques.map(a => ({ id: a.id, nome: a.nome, ativo: a.id === this.ataqueId })),
      pedeMunicao,
      semMunicao,
      municoes: municoes.map(m => ({
        id: m.id, nome: `${m.name} (x${m.system.quantidade})`, ativo: m.id === this.municaoId
      })),
      condicao: textoDaCondicao(sys),
      reacao,
      reacaoTitulo: reacao ? loc(reacao === "esquiva" ? "PYRO.Esquivar" : "PYRO.Bloquear") : "",
      camposReacao: reacao ? camposDaReacao(this.actor, reacao) : "",

      estaminaAtual: estamina.value,
      estaminaMax: estamina.max,
      custoTotal: calc.estamina,
      restante: Math.max(0, estamina.value - calc.estamina),
      // Estamina que não houver sai da vida: a janela diz quanto antes de executar.
      pagaComVida: calc.estamina > estamina.value,
      vidaTexto: game.i18n.format("PYRO.Executor.EstaminaEVida", {
        n: calc.estamina, pv: calc.estamina - Math.max(0, estamina.value)
      }),
      pctUsada: estamina.max > 0 ? Math.clamp((estamina.value / estamina.max) * 100, 0, 100) : 0,
      pctCusto: estamina.max > 0 ? Math.clamp((calc.estamina / estamina.max) * 100, 0, 100) : 0,
      faltaEstamina,

      limite: calc.limite,
      limiteTexto: game.i18n.format("PYRO.Executor.Limite", { n: calc.limite }),
      excesso: calc.excesso,
      excessoTexto: calc.excesso > 0
        ? game.i18n.format("PYRO.Executor.Excesso", { excesso: calc.excesso, nd: calc.nd })
        : "",
      /*
       * O custo mostrado é o que vai ser cobrado: com os efeitos de custo e
       * com a ação extra da confusão. Mostrar o número escrito na técnica
       * faria a janela discordar do card no instante seguinte.
       */
      acoesTexto: game.i18n.format(
        base?.reacao ? "PYRO.Chat.CustoReacoes" : "PYRO.Chat.CustoAcoes",
        { acoes: this.#custoEmAcoes(sys, base, ataque) }),
      baseTexto: loc(base?.label ?? ""),
      /*
       * A prévia mostra as fórmulas como estão escritas, com o [FOR] dentro.
       * Sob abatido o dano sai sem ele, e a janela avisa em vez de prometer um
       * número que a rolagem não vai dar.
       */
      avisoMental: regraMental(this.actor, "semForNoDano")
        ? loc("PYRO.Mental.SemForNoDano") : "",
      podeExecutar: this._podeExecutar
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /** Guarda a arma e a munição escolhidas antes de redesenhar a janela. */
  #capturarCampos() {
    const escolhido = this.element?.querySelector("[name=ataque]")?.value;
    if (escolhido) this.ataqueId = escolhido;
    const municao = this.element?.querySelector("[name=municao]")?.value;
    if (municao) this.municaoId = municao;
  }

  #redesenhar() {
    this.#capturarCampos();
    return this.render({ parts: PARTES_DO_ESFORCO });
  }

  static #subirEsforco(event, target) {
    const chave = target.dataset.chave;
    this.esforcos[chave] = Math.max(this.minimo, this.esforcos[chave] ?? 0) + 1;
    this.#redesenhar();
  }

  // O piso é o da técnica (ver esforcoMinimo): 1 nas próprias, 0 nas básicas.
  static #descerEsforco(event, target) {
    const chave = target.dataset.chave;
    this.esforcos[chave] = Math.max(this.minimo, (this.esforcos[chave] ?? 0) - 1);
    this.#redesenhar();
  }

  static #zerarEsforcos() {
    for (const chave of Object.keys(this.esforcos)) this.esforcos[chave] = this.minimo;
    this.#redesenhar();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor);
    const botao = this.element.querySelector("button[type=submit]");
    if (botao) botao.disabled = !this._podeExecutar;
    // Trocar a arma muda o dano da prévia e a munição que ela pede.
    if (options.parts?.includes("form")) {
      for (const campo of this.element.querySelectorAll("[name=ataque], [name=municao]")) {
        campo.addEventListener("change", () => this.#redesenhar());
      }
    }
    // Uma vez por desenho da parte da reação, senão cada clique no "+"
    // criaria tantas linhas de dano quantas vezes o Esforço mudou.
    if (options.parts?.includes("reacao")) ligarCamposDeDano(this.element);
  }

  static async #aoExecutar(_event, _form, formData) {
    this.#capturarCampos();
    if (!this._podeExecutar) return;
    /*
     * Só fecha se a técnica saiu mesmo: barrada por peso ou por postura, a
     * janela fica aberta com os Esforços escolhidos, em vez de sumir levando
     * a escolha junto.
     */
    const feito = await usarTecnica(this.actor, this.item, {
      esforcos: this.esforcos,
      ataqueId: this.ataqueId,
      municaoId: this.municaoId,
      respostas: reacaoDaTecnica(this.item.system) ? formData.object : null
    });
    if (feito) this.close();
  }
}
