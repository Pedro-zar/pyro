import { PYRO } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Criação guiada de Active Effects: em vez de digitar caminhos como
 * "system.atributos.for.valor", o jogador escolhe categoria e alvo em listas.
 * Depois de criado, o efeito continua editável pela ficha padrão do Foundry.
 */
export class ConstrutorEfeitoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ documento, categoria = "passivos", ...options } = {}) {
    super(options);
    this.documento = documento;
    this.categoria = categoria;
    this.mudancas = [{ categoria: "atributos", alvo: "system.atributos.for.valor", modo: 2, valor: "1" }];
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-construtor-efeito-{id}",
    classes: ["pyro", "construtor-efeito"],
    tag: "form",
    position: { width: 620, height: "auto" },
    window: { title: "PYRO.Efeitos.Construtor", resizable: true },
    form: { handler: ConstrutorEfeitoApp.#criar, closeOnSubmit: true },
    actions: {
      adicionarMudanca: ConstrutorEfeitoApp.#adicionarMudanca,
      removerMudanca: ConstrutorEfeitoApp.#removerMudanca,
      avancado: ConstrutorEfeitoApp.#avancado
    }
  };

  static PARTS = {
    form: { template: "systems/pyro/templates/apps/construtor-efeito.hbs" }
  };

  /* ---------------------------------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const categorias = Object.fromEntries(
      Object.entries(PYRO.alvosEfeito).map(([k, v]) => [k, v.label])
    );

    context.categorias = categorias;
    context.modos = PYRO.modosEfeito;
    context.temporario = this.categoria === "temporarios";
    context.inativo = this.categoria === "inativos";
    // Só itens podem ter efeito de uso: num ator, todo efeito é dele próprio.
    context.podeSerDeUso = this.documento instanceof Item;
    context.deUso = this.deUso ?? false;
    context.mudancas = this.mudancas.map((m, i) => ({
      ...m,
      index: i,
      // Condição não tem modo nem valor: só marca o alvo com o status.
      ehCondicao: m.categoria === "condicao",
      alvos: PYRO.alvosEfeito[m.categoria]?.alvos ?? {}
    }));
    return context;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // Trocar a categoria refaz a lista de alvos.
    this.element.addEventListener("change", event => {
      const alvo = event.target;
      if (!alvo.matches("[data-campo=categoria]")) return;
      const i = Number(alvo.closest("[data-index]").dataset.index);
      this.#capturar();
      this.mudancas[i].categoria = alvo.value;
      this.mudancas[i].alvo = Object.keys(PYRO.alvosEfeito[alvo.value]?.alvos ?? {})[0] ?? "";
      this.render();
    });
  }

  /** Lê o formulário na lista de trabalho (sem gravar nada ainda). */
  #capturar() {
    const dados = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    this.nome = dados.nome ?? this.nome;
    this.rodadas = Number(dados.rodadas) || 0;
    this.deUso = dados.deUso ?? this.deUso;
    this.mudancas = this.mudancas.map((m, i) => ({
      categoria: dados[`mudanca.${i}.categoria`] ?? m.categoria,
      alvo: dados[`mudanca.${i}.alvo`] ?? m.alvo,
      modo: Number(dados[`mudanca.${i}.modo`] ?? m.modo),
      valor: dados[`mudanca.${i}.valor`] ?? m.valor
    }));
    return dados;
  }

  static #adicionarMudanca() {
    this.#capturar();
    this.mudancas.push({ categoria: "atributos", alvo: "system.atributos.for.valor", modo: 2, valor: "1" });
    this.render();
  }

  static #removerMudanca(event, target) {
    this.#capturar();
    this.mudancas.splice(Number(target.dataset.index), 1);
    if (!this.mudancas.length) {
      this.mudancas.push({ categoria: "atributos", alvo: "system.atributos.for.valor", modo: 2, valor: "1" });
    }
    this.render();
  }

  /** Cria o efeito e abre a ficha completa do Foundry pra ajustes finos. */
  static async #avancado() {
    const efeito = await this.#gravar();
    if (efeito) efeito.sheet.render(true);
    this.close();
  }

  static async #criar() {
    await this.#gravar();
  }

  async #gravar() {
    const dados = this.#capturar();
    const rodadas = Number(dados.rodadas) || 0;
    // Efeito de uso vai para o alvo ao usar o item, então não transfere
    // automaticamente para quem carrega.
    const deUso = !!dados.deUso;

    // Condições viram statuses (marcadores no token); o resto vira changes.
    const condicoes = this.mudancas.filter(m => m.categoria === "condicao" && m.alvo);
    const mudancas = this.mudancas.filter(m => m.categoria !== "condicao" && m.alvo);

    // Sem nome digitado, a primeira condição batiza o efeito e dá o ícone.
    let nome = (dados.nome ?? "").trim();
    const primeira = condicoes.length ? PYRO.condicoes[condicoes[0].alvo] : null;
    if (primeira && (!nome || nome === game.i18n.localize("PYRO.Efeitos.Novo"))) {
      nome = game.i18n.localize(primeira.label);
    }
    if (!nome) nome = game.i18n.localize("PYRO.Efeitos.Novo");

    const efeito = {
      name: nome,
      img: dados.img || primeira?.img || "icons/svg/aura.svg",
      origin: this.documento.uuid,
      disabled: this.categoria === "inativos",
      transfer: !deUso,
      flags: { pyro: { deUso } },
      statuses: [...new Set(condicoes.map(m => m.alvo))],
      changes: mudancas
        .map(m => ({ key: m.alvo, mode: Number(m.modo), value: String(m.valor ?? ""), priority: 20 }))
    };
    if (rodadas > 0) efeito.duration = { rounds: rodadas };

    const criados = await ActiveEffect.implementation.create(efeito, { parent: this.documento });
    return Array.isArray(criados) ? criados[0] : criados;
  }
}
