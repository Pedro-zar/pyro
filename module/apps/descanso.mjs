/**
 * Ações de descanso: o jogador distribui as ações que o descanso dá entre o
 * que o personagem faz, e clica em Descansar. Quem recupera é descansar(), em
 * descanso.mjs; a janela só monta a escolha.
 */
import { caminho } from "../sistema.mjs";
import {
  QUALIDADES, acoesParaEscolher, acoesGastas, descansar, textoDeAcoes, opcoesDeEscolha
} from "../descanso.mjs";
import { pintarTema } from "../tema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const loc = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

export class DescansoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, qualidade, mensagemId, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.qualidade = qualidade;
    this.mensagemId = mensagemId;
    /** Quantas vezes cada ação foi escolhida. */
    this.vezes = {};
    /** O que foi escolhido em cada ação (perícia, recurso), na ordem das vezes. */
    this.alvos = {};
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-descanso-{id}",
    classes: ["pyro", "descanso"],
    tag: "form",
    position: { width: 640, height: "auto" },
    window: { title: "PYRO.Descanso.Titulo", resizable: true },
    form: { handler: DescansoApp.#aoDescansar, closeOnSubmit: false },
    actions: {
      mais: DescansoApp.#mais,
      menos: DescansoApp.#menos
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/descanso.hbs") }
  };

  get title() {
    return loc("PYRO.Descanso.TituloDe", { nome: this.actor?.name ?? "" });
  }

  get #limite() {
    return QUALIDADES[this.qualidade]?.acoes ?? 0;
  }

  #escolhas() {
    return Object.fromEntries(Object.entries(this.vezes)
      .filter(([, n]) => n > 0)
      .map(([chave, n]) => [chave, { vezes: n, alvos: this.alvos[chave] ?? [] }]));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const opcoes = opcoesDeEscolha(this.actor);
    const gasto = acoesGastas(this.#escolhas());
    const sobra = this.#limite - gasto;

    const acoes = acoesParaEscolher().map(a => {
      const vezes = this.vezes[a.chave] ?? 0;
      // Uma escolha por vez no Meditar e no Praticar; uma só no Aprender.
      const lista = opcoes[a.escolhe] ?? [];
      const quantas = a.quantas === "porVez" ? vezes : (a.escolhe && vezes ? 1 : 0);
      const escolhidas = this.alvos[a.chave] ?? [];
      return {
        ...a,
        vezes,
        gastoTexto: textoDeAcoes(vezes * a.custo),
        podeMais: sobra >= a.custo,
        podeMenos: vezes > 0,
        // Sem o que escolher (ficha sem perícia, ou sem recurso para
        // meditar), a linha diz isso em vez de mostrar um select vazio.
        semOpcoes: quantas > 0 && !lista.length
          ? loc(a.escolhe === "recurso" ? "PYRO.Descanso.SemRecursos" : "PYRO.Descanso.SemPericias") : "",
        rotuloDaEscolha: loc(a.escolhe === "recurso" ? "PYRO.Descanso.Recurso" : "PYRO.Descanso.Pericia"),
        escolhas: lista.length ? Array.from({ length: quantas }, (_, i) => ({
          i,
          opcoes: lista.map(o => ({ ...o, marcada: o.id === (escolhidas[i] ?? lista[0].id) }))
        })) : []
      };
    });

    return Object.assign(context, {
      qualidade: loc(QUALIDADES[this.qualidade]?.label ?? ""),
      tiraExaustao: (QUALIDADES[this.qualidade]?.exaustao ?? 0) > 0,
      semAcoes: this.#limite === 0,
      acoes,
      totalTexto: loc("PYRO.Descanso.Total", { n: gasto, max: this.#limite })
    });
  }

  /** O que está escolhido nos selects, para sobreviver ao redesenho. */
  #lerAlvos() {
    for (const select of this.element?.querySelectorAll("select[name^='alvo.']") ?? []) {
      const [, chave, i] = select.name.split(".");
      (this.alvos[chave] ??= [])[Number(i)] = select.value;
    }
  }

  /*
   * A escolha de cada vez que ainda não foi tocada: a primeira da lista, que
   * é o que o select mostra.
   */
  #completarAlvos() {
    const opcoes = opcoesDeEscolha(this.actor);
    for (const a of acoesParaEscolher()) {
      const primeira = opcoes[a.escolhe]?.[0]?.id;
      if (!a.escolhe || !primeira) continue;
      const quantas = a.quantas === "porVez" ? (this.vezes[a.chave] ?? 0) : 1;
      const lista = (this.alvos[a.chave] ??= []);
      for (let i = 0; i < quantas; i++) lista[i] ??= primeira;
    }
  }

  static #mais(event, target) {
    this.#lerAlvos();
    const chave = target.dataset.chave;
    const custo = acoesParaEscolher().find(a => a.chave === chave)?.custo ?? 1;
    if (acoesGastas(this.#escolhas()) + custo > this.#limite) return;
    this.vezes[chave] = (this.vezes[chave] ?? 0) + 1;
    this.render();
  }

  static #menos(event, target) {
    this.#lerAlvos();
    const chave = target.dataset.chave;
    this.vezes[chave] = Math.max(0, (this.vezes[chave] ?? 0) - 1);
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor);
  }

  static async #aoDescansar() {
    this.#lerAlvos();
    this.#completarAlvos();
    const escolhas = this.#escolhas();
    if (escolhas.praticar && !escolhas.praticar.alvos.filter(Boolean).length) {
      return ui.notifications.warn(loc("PYRO.Descanso.EscolhaPericia"));
    }
    const feito = await descansar(this.actor, {
      qualidade: this.qualidade, mensagemId: this.mensagemId, escolhas
    });
    if (feito) {
      // O card de onde o descanso saiu passa a mostrar que já foi usado.
      ui.chat?.updateMessage?.(game.messages.get(this.mensagemId));
      return this.close();
    }
  }
}
