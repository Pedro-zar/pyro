/**
 * Ações de descanso: o jogador distribui as ações que o descanso dá entre o
 * que o personagem faz, e clica em Descansar. Quem recupera é descansar(), em
 * descanso.mjs; a janela só monta a escolha.
 */
import { caminho } from "../sistema.mjs";
import { QUALIDADES, acoesParaEscolher, acoesGastas, descansar, textoDeAcoes } from "../descanso.mjs";
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
    /** As perícias escolhidas por ação, na ordem das vezes. */
    this.pericias = {};
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
      .map(([chave, n]) => [chave, { vezes: n, pericias: this.pericias[chave] ?? [] }]));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const pericias = this.actor.items.filter(i => i.type === "pericia")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => ({ id: i.id, nome: i.name }));
    const gasto = acoesGastas(this.#escolhas());
    const sobra = this.#limite - gasto;

    const acoes = acoesParaEscolher().map(a => {
      const vezes = this.vezes[a.chave] ?? 0;
      // Uma escolha de perícia por vez no Praticar; uma só no Aprender.
      const quantas = a.pericias === "porVez" ? vezes : (a.pericias && vezes ? 1 : 0);
      const escolhidas = this.pericias[a.chave] ?? [];
      return {
        ...a,
        vezes,
        gastoTexto: textoDeAcoes(vezes * a.custo),
        podeMais: sobra >= a.custo,
        podeMenos: vezes > 0,
        escolhas: Array.from({ length: quantas }, (_, i) => ({
          i,
          opcoes: pericias.map(p => ({ ...p, marcada: p.id === (escolhidas[i] ?? pericias[0]?.id) }))
        }))
      };
    });

    return Object.assign(context, {
      qualidade: loc(QUALIDADES[this.qualidade]?.label ?? ""),
      tiraExaustao: (QUALIDADES[this.qualidade]?.exaustao ?? 0) > 0,
      semAcoes: this.#limite === 0,
      acoes,
      semPericias: !pericias.length,
      totalTexto: loc("PYRO.Descanso.Total", { n: gasto, max: this.#limite })
    });
  }

  /** As perícias escolhidas nos selects, para sobreviver ao redesenho. */
  #lerPericias() {
    for (const select of this.element?.querySelectorAll("select[name^='pericia.']") ?? []) {
      const [, chave, i] = select.name.split(".");
      (this.pericias[chave] ??= [])[Number(i)] = select.value;
    }
  }

  /*
   * Perícia escolhida em cada vez que ainda não foi tocada: a primeira da
   * lista, que é o que o select mostra.
   */
  #completarPericias() {
    const primeira = this.actor.items.find(i => i.type === "pericia")?.id;
    for (const a of acoesParaEscolher()) {
      if (!a.pericias) continue;
      const quantas = a.pericias === "porVez" ? (this.vezes[a.chave] ?? 0) : 1;
      const lista = (this.pericias[a.chave] ??= []);
      for (let i = 0; i < quantas; i++) lista[i] ??= primeira;
    }
  }

  static #mais(event, target) {
    this.#lerPericias();
    const chave = target.dataset.chave;
    const custo = acoesParaEscolher().find(a => a.chave === chave)?.custo ?? 1;
    if (acoesGastas(this.#escolhas()) + custo > this.#limite) return;
    this.vezes[chave] = (this.vezes[chave] ?? 0) + 1;
    this.render();
  }

  static #menos(event, target) {
    this.#lerPericias();
    const chave = target.dataset.chave;
    this.vezes[chave] = Math.max(0, (this.vezes[chave] ?? 0) - 1);
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor);
  }

  static async #aoDescansar() {
    this.#lerPericias();
    this.#completarPericias();
    const escolhas = this.#escolhas();
    if (escolhas.praticar && !escolhas.praticar.pericias.filter(Boolean).length) {
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
