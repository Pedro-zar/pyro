import { PYRO } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Editor das tabelas de línguas/potenciais e elementos (só para o mestre). */
export class ConfigMagiaApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-magia",
    classes: ["pyro", "config-magia"],
    tag: "form",
    position: { width: 720, height: 700 },
    window: { title: "PYRO.Config.Nome", resizable: true },
    form: { handler: ConfigMagiaApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionarLingua: ConfigMagiaApp.#adicionarLingua,
      removerLingua: ConfigMagiaApp.#removerLingua,
      adicionarElemento: ConfigMagiaApp.#adicionarElemento,
      removerElemento: ConfigMagiaApp.#removerElemento,
      adicionarRaca: ConfigMagiaApp.#adicionarRaca,
      removerRaca: ConfigMagiaApp.#removerRaca,
      adicionarRecurso: ConfigMagiaApp.#adicionarRecurso,
      removerRecurso: ConfigMagiaApp.#removerRecurso,
      restaurar: ConfigMagiaApp.#restaurar
    }
  };

  static PARTS = {
    form: { template: "systems/pyro/templates/apps/config-magia.hbs" }
  };

  /** Cópia de trabalho: só grava no submit. */
  #dados = null;

  #carregar() {
    if (this.#dados) return this.#dados;
    this.#dados = {
      linguas: foundry.utils.deepClone(game.settings.get("pyro", "linguas")),
      elementos: foundry.utils.deepClone(game.settings.get("pyro", "elementos")),
      racas: foundry.utils.deepClone(game.settings.get("pyro", "racas")),
      recursos: foundry.utils.deepClone(game.settings.get("pyro", "recursosCustom"))
    };
    return this.#dados;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const d = this.#carregar();

    context.linguas = Object.entries(d.linguas).map(([chave, v]) => ({
      chave, ...v,
      label: game.i18n.localize(v.label),
      povo: game.i18n.localize(v.povo ?? v.label)
    }));
    context.elementos = Object.entries(d.elementos).map(([chave, v]) => ({
      chave, ...v,
      label: game.i18n.localize(v.label),
      efeito: game.i18n.localize(v.efeito ?? "")
    }));
    context.racas = Object.entries(d.racas).map(([chave, v]) => ({
      chave, ...v,
      label: game.i18n.localize(v.label),
      nome: game.i18n.localize(v.nome ?? v.label)
    }));
    context.recursos = Object.entries(d.recursos).map(([chave, v]) => ({
      chave, ...v, label: game.i18n.localize(v.label)
    }));
    context.atributos = Object.fromEntries(
      Object.entries(PYRO.atributos).map(([k, v]) => [k, game.i18n.localize(v)])
    );
    context.atributosOpcionais = {
      "": game.i18n.localize("PYRO.Config.SemRecuperacao"),
      ...context.atributos
    };
    context.recursosConcedidos = Object.fromEntries(
      Object.entries(d.recursos).map(([k, v]) => [k, game.i18n.localize(v.label)])
    );
    context.potenciais = Object.fromEntries(
      Object.entries(d.linguas).map(([k, v]) => [k, game.i18n.localize(v.povo ?? v.label)])
    );
    context.tiposDano = {
      "": game.i18n.localize("PYRO.Config.SemDano"),
      ...Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, v]) => [k, game.i18n.localize(v.label)])),
      cura: game.i18n.localize("PYRO.Dano.cura"),
      indefinido: game.i18n.localize("PYRO.Dano.indefinido")
    };
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /** Lê o formulário na cópia de trabalho antes de re-renderizar. */
  #capturar() {
    // FormDataExtended.object já vem expandido em objetos aninhados; achatar
    // devolve as chaves "lingua.humana.fator" usadas abaixo.
    const dados = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    const d = this.#carregar();

    for (const [chave, v] of Object.entries(d.linguas)) {
      v.label = dados[`lingua.${chave}.label`] ?? v.label;
      v.povo = dados[`lingua.${chave}.povo`] ?? v.povo;
      v.fator = Number(dados[`lingua.${chave}.fator`] ?? v.fator) || 1;
      v.efeito = Number(dados[`lingua.${chave}.efeito`] ?? v.efeito) || 1;
    }
    for (const [chave, v] of Object.entries(d.elementos)) {
      v.label = dados[`elemento.${chave}.label`] ?? v.label;
      v.grupo = dados[`elemento.${chave}.grupo`] ?? v.grupo;
      v.tipoDano = dados[`elemento.${chave}.tipoDano`] ?? v.tipoDano;
      v.base = Number(dados[`elemento.${chave}.base`] ?? v.base) || 0;
      v.porIntencao = Number(dados[`elemento.${chave}.porIntencao`] ?? v.porIntencao) || 0;
      v.faces = Number(dados[`elemento.${chave}.faces`] ?? v.faces) || 0;
      v.efeito = dados[`elemento.${chave}.efeito`] ?? v.efeito;
      v.subjulgar = !!dados[`elemento.${chave}.subjulgar`];
    }
    for (const [chave, v] of Object.entries(d.racas)) {
      v.label = dados[`raca.${chave}.label`] ?? v.label;
      v.nome = dados[`raca.${chave}.nome`] ?? v.nome;
      v.potencial = dados[`raca.${chave}.potencial`] ?? v.potencial;
      v.magia = !!dados[`raca.${chave}.magia`];
      v.feiticos = !!dados[`raca.${chave}.feiticos`];
      v.detalhe = !!dados[`raca.${chave}.detalhe`];
      v.custom = !!dados[`raca.${chave}.custom`];
      const concedidos = Object.keys(d.recursos)
        .filter(rk => dados[`raca.${chave}.recursos.${rk}`]);
      if (Object.keys(d.recursos).length) v.recursos = concedidos;
    }
    for (const [chave, v] of Object.entries(d.recursos)) {
      v.label = dados[`recurso.${chave}.label`] ?? v.label;
      v.atributo = dados[`recurso.${chave}.atributo`] ?? v.atributo;
      v.porPonto = Number(dados[`recurso.${chave}.porPonto`] ?? v.porPonto) || 0;
      v.base = Number(dados[`recurso.${chave}.base`] ?? v.base) || 0;
      v.recAtributo = dados[`recurso.${chave}.recAtributo`] ?? v.recAtributo;
      v.recPorPonto = Number(dados[`recurso.${chave}.recPorPonto`] ?? v.recPorPonto) || 0;
    }
    return d;
  }

  static #adicionarRaca() {
    const d = this.#capturar();
    const chave = `raca${Object.keys(d.racas).length + 1}`;
    const rotulo = game.i18n.localize("PYRO.Config.RacaNova");
    d.racas[chave] = {
      label: rotulo, nome: rotulo, potencial: Object.keys(d.linguas)[0] ?? "humana",
      magia: false, feiticos: false, detalhe: false, custom: true
    };
    this.render();
  }

  static #removerRaca(event, target) {
    const d = this.#capturar();
    delete d.racas[target.dataset.chave];
    this.render();
  }

  static #adicionarRecurso() {
    const d = this.#capturar();
    const chave = `recurso${Object.keys(d.recursos).length + 1}`;
    d.recursos[chave] = {
      label: game.i18n.localize("PYRO.Config.RecursoNovo"),
      atributo: "sab", porPonto: 5, base: 0, recAtributo: "int", recPorPonto: 1
    };
    this.render();
  }

  static #removerRecurso(event, target) {
    const d = this.#capturar();
    delete d.recursos[target.dataset.chave];
    this.render();
  }

  static #adicionarLingua() {
    const d = this.#capturar();
    const chave = `lingua${Object.keys(d.linguas).length + 1}`;
    d.linguas[chave] = { label: chave, povo: chave, fator: 1, efeito: 1 };
    this.render();
  }

  static #removerLingua(event, target) {
    const d = this.#capturar();
    delete d.linguas[target.dataset.chave];
    this.render();
  }

  static #adicionarElemento() {
    const d = this.#capturar();
    const chave = `elemento${Object.keys(d.elementos).length + 1}`;
    d.elementos[chave] = {
      label: chave, grupo: chave, tipoDano: "impacto",
      base: 1, porIntencao: 1, faces: 6, efeito: "", subjulgar: false
    };
    this.render();
  }

  static #removerElemento(event, target) {
    const d = this.#capturar();
    delete d.elementos[target.dataset.chave];
    this.render();
  }

  static async #restaurar() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PYRO.Config.Restaurar") },
      content: `<p>${game.i18n.localize("PYRO.Config.RestaurarAviso")}</p>`
    });
    if (!ok) return;
    this.#dados = {
      linguas: foundry.utils.deepClone(PYRO.linguasPadrao),
      elementos: foundry.utils.deepClone(PYRO.elementosPadrao),
      racas: foundry.utils.deepClone(PYRO.racasPadrao),
      recursos: foundry.utils.deepClone(PYRO.recursosCustomPadrao)
    };
    this.render();
  }

  static async #salvar(event, form, formData) {
    const d = this.#capturar();
    await game.settings.set("pyro", "linguas", d.linguas);
    await game.settings.set("pyro", "elementos", d.elementos);
    await game.settings.set("pyro", "racas", d.racas);
    await game.settings.set("pyro", "recursosCustom", d.recursos);
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
