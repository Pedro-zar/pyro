/**
 * Progressão (só para o mestre): curva de custo por ranque, regras por nome de
 * habilidade e as tabelas de nível por uso.
 */
import { PYRO } from "../config.mjs";
import { SYSTEM_ID, caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Trilhas de avanço, na ordem em que aparecem na tela. */
const TRILHAS = ["pericia", "magiaTecnica"];

export class ConfigProgressaoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-progressao",
    classes: ["pyro", "config-magia", "config-progressao"],
    tag: "form",
    position: { width: 720, height: 640 },
    window: { title: "PYRO.Progressao.Nome", resizable: true },
    form: { handler: ConfigProgressaoApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionarRegra: ConfigProgressaoApp.#adicionarRegra,
      removerRegra: ConfigProgressaoApp.#removerRegra,
      restaurarCurva: ConfigProgressaoApp.#restaurarCurva,
      restaurarTabela: ConfigProgressaoApp.#restaurarTabela
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/config-progressao.hbs") }
  };

  /** Cópia de trabalho: só grava no submit. */
  #dados = null;

  #carregar() {
    this.#dados ??= {
      curva: { ...PYRO.curvaXpPadrao, ...(game.settings.get(SYSTEM_ID, "curvaXp") ?? {}) },
      regras: foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "progressoes") ?? {}),
      avanco: foundry.utils.deepClone(PYRO.avancoPorUso)
    };
    return this.#dados;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { curva, regras, avanco } = this.#carregar();
    const loc = k => game.i18n.localize(k);

    context.curva = curva;
    context.exemploCurva = ConfigProgressaoApp.#exemplo(curva, 1);
    context.regras = Object.entries(regras).map(([chave, regra]) => ({
      chave, ...regra,
      // Prévia dos custos: o mestre vê o efeito da regra sem abrir uma ficha.
      exemplo: ConfigProgressaoApp.#exemplo(curva, regra.multiplicador)
    }));
    context.trilhas = TRILHAS.map(chave => ({
      chave,
      titulo: loc(`PYRO.Progressao.Trilha.${chave}`),
      linhas: (avanco[chave] ?? []).map((linha, i) => ({ nivel: i + 1, ...linha }))
    }));
    context.modos = { ou: loc("PYRO.Progressao.ModoOu"), e: loc("PYRO.Progressao.ModoE") };
    return context;
  }

  /** Custos dos cinco primeiros ranques, como "3 · 6 · 12 · 24 · 48". */
  static #exemplo(curva, multiplicador) {
    return Array.from({ length: 5 }, (_, i) => PYRO.custoDoRanque(i + 1, multiplicador, curva)).join(" · ");
  }

  /* ---------------------------------------------------------------------- */

  /** Lê o formulário na cópia de trabalho antes de re-renderizar. */
  #capturar() {
    const form = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    const dados = this.#carregar();
    const numero = (chave, atual, { min = 0, inteiro = false } = {}) => {
      const n = Number(form[chave]);
      if (!Number.isFinite(n)) return atual;
      return Math.max(min, inteiro ? Math.round(n) : n);
    };

    dados.curva.custoBase = numero("curva.custoBase", dados.curva.custoBase, { inteiro: true });
    dados.curva.fator = numero("curva.fator", dados.curva.fator);

    for (const [chave, regra] of Object.entries(dados.regras)) {
      regra.label = form[`regra.${chave}.label`] ?? regra.label;
      regra.nomes = form[`regra.${chave}.nomes`] ?? regra.nomes;
      regra.multiplicador = numero(`regra.${chave}.multiplicador`, regra.multiplicador);
    }

    for (const trilha of TRILHAS) {
      dados.avanco[trilha] = (dados.avanco[trilha] ?? []).map((linha, i) => ({
        rr: numero(`avanco.${trilha}.${i}.rr`, linha.rr, { inteiro: true }),
        rd: numero(`avanco.${trilha}.${i}.rd`, linha.rd, { inteiro: true }),
        rmd: numero(`avanco.${trilha}.${i}.rmd`, linha.rmd, { inteiro: true }),
        modo: form[`avanco.${trilha}.${i}.modo`] === "e" ? "e" : "ou"
      }));
    }
    return dados;
  }

  static #adicionarRegra() {
    const { regras } = this.#capturar();
    // Chave estável e sem colisão, mesmo depois de remover regras do meio.
    let n = Object.keys(regras).length + 1;
    while (regras[`progressao${n}`]) n++;
    regras[`progressao${n}`] = {
      label: game.i18n.localize("PYRO.Progressao.RegraNova"),
      nomes: "",
      multiplicador: 0.5
    };
    this.render();
  }

  static #removerRegra(event, target) {
    const { regras } = this.#capturar();
    delete regras[target.dataset.chave];
    this.render();
  }

  static #restaurarCurva() {
    const dados = this.#capturar();
    dados.curva = { ...PYRO.curvaXpPadrao };
    this.render();
  }

  static #restaurarTabela(event, target) {
    const dados = this.#capturar();
    const trilha = target.dataset.trilha;
    dados.avanco[trilha] = foundry.utils.deepClone(PYRO.avancoPorUsoPadrao[trilha]);
    this.render();
  }

  static async #salvar() {
    const { curva, regras, avanco } = this.#capturar();
    await game.settings.set(SYSTEM_ID, "curvaXp", curva);
    await game.settings.set(SYSTEM_ID, "progressoes", regras);
    await game.settings.set(SYSTEM_ID, "avancoPorUso", avanco);
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
