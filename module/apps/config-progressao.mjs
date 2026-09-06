import { PYRO } from "../config.mjs";
import { SYSTEM_ID, caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Regras de progressão de XP (só para o mestre).
 *
 * A ideia é manter a criação de habilidade sem campo nenhum a mais: o
 * comportamento especial é disparado pelo nome. A mesa registra aqui quais
 * nomes de habilidade mudam a curva do Caminho, e o jogador só precisa criar a
 * habilidade com aquele nome.
 */
export class ConfigProgressaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-progressao",
    classes: ["pyro", "config-magia", "config-progressao"],
    tag: "form",
    position: { width: 680, height: 560 },
    window: { title: "PYRO.Progressao.Nome", resizable: true },
    form: { handler: ConfigProgressaoApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionarRegra: ConfigProgressaoApp.#adicionarRegra,
      removerRegra: ConfigProgressaoApp.#removerRegra
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/config-progressao.hbs") }
  };

  /** Cópia de trabalho: só grava no submit. */
  #dados = null;

  #carregar() {
    this.#dados ??= foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "progressoes") ?? {});
    return this.#dados;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const regras = this.#carregar();

    context.regras = Object.entries(regras).map(([chave, v]) => ({
      chave, ...v,
      // Prévia da curva: o mestre vê o efeito da regra sem abrir uma ficha.
      exemplo: ConfigProgressaoApp.#exemplo(v)
    }));
    context.exemploPadrao = ConfigProgressaoApp.#exemplo({ passo: 1, multiplicador: 1 });
    return context;
  }

  /** Os seis primeiros custos da curva, como "1 · 1 · 2 · 2 · 3 · 3". */
  static #exemplo({ passo = 1, multiplicador = 1 } = {}) {
    const p = Math.max(1, Math.round(passo) || 1);
    const m = Number(multiplicador) || 0;
    return Array.from({ length: 6 }, (_, i) =>
      Math.max(0, Math.round(m * Math.ceil((i + 1) / p)))).join(" · ");
  }

  /* ---------------------------------------------------------------------- */

  /** Lê o formulário na cópia de trabalho antes de re-renderizar. */
  #capturar() {
    const dados = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    const regras = this.#carregar();
    for (const [chave, v] of Object.entries(regras)) {
      v.label = dados[`regra.${chave}.label`] ?? v.label;
      v.nomes = dados[`regra.${chave}.nomes`] ?? v.nomes;
      v.passo = Math.max(1, Math.round(Number(dados[`regra.${chave}.passo`] ?? v.passo)) || 1);
      v.multiplicador = Number(dados[`regra.${chave}.multiplicador`] ?? v.multiplicador);
      if (!Number.isFinite(v.multiplicador)) v.multiplicador = 1;
    }
    return regras;
  }

  static #adicionarRegra() {
    const regras = this.#capturar();
    // Chave estável e sem colisão, mesmo depois de remover regras do meio.
    let n = Object.keys(regras).length + 1;
    while (regras[`progressao${n}`]) n++;
    regras[`progressao${n}`] = {
      label: game.i18n.localize("PYRO.Progressao.RegraNova"),
      nomes: "",
      passo: 2,
      multiplicador: 1
    };
    this.render();
  }

  static #removerRegra(event, target) {
    const regras = this.#capturar();
    delete regras[target.dataset.chave];
    this.render();
  }

  static async #salvar() {
    const regras = this.#capturar();
    await game.settings.set(SYSTEM_ID, "progressoes", regras);
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
