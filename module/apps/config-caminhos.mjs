import { PYRO } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Tudo que define um Caminho racial, num lugar só (e só para o mestre):
 * as raças pré-definidas, os potenciais mágicos que elas carregam e os
 * recursos próprios que elas concedem.
 *
 * As três tabelas vivem juntas porque se referenciam: a raça aponta para um
 * potencial e marca quais recursos concede. Separá-las obrigaria a abrir duas
 * telas para cadastrar uma raça nova.
 */
export class ConfigCaminhosApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-caminhos",
    classes: ["pyro", "config-magia", "config-caminhos"],
    tag: "form",
    position: { width: 720, height: 700 },
    window: { title: "PYRO.ConfigCaminhos.Nome", resizable: true },
    form: { handler: ConfigCaminhosApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionarLingua: ConfigCaminhosApp.#adicionarLingua,
      removerLingua: ConfigCaminhosApp.#removerLingua,
      adicionarRaca: ConfigCaminhosApp.#adicionarRaca,
      removerRaca: ConfigCaminhosApp.#removerRaca,
      adicionarRecurso: ConfigCaminhosApp.#adicionarRecurso,
      removerRecurso: ConfigCaminhosApp.#removerRecurso,
      restaurar: ConfigCaminhosApp.#restaurar
    }
  };

  static PARTS = {
    form: { template: "systems/pyro/templates/apps/config-caminhos.hbs" }
  };

  /** Cópia de trabalho: só grava no submit. */
  #dados = null;

  #carregar() {
    this.#dados ??= {
      linguas: foundry.utils.deepClone(game.settings.get("pyro", "linguas")),
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
    context.potenciais = Object.fromEntries(
      Object.entries(d.linguas).map(([k, v]) => [k, game.i18n.localize(v.povo ?? v.label)])
    );
    context.tamanhos = Object.fromEntries(
      Object.entries(PYRO.tamanhos).map(([k, v]) => [k, game.i18n.localize(v.label)])
    );
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
    for (const [chave, v] of Object.entries(d.recursos)) {
      v.label = dados[`recurso.${chave}.label`] ?? v.label;
      v.atributo = dados[`recurso.${chave}.atributo`] ?? v.atributo;
      v.porPonto = Number(dados[`recurso.${chave}.porPonto`] ?? v.porPonto) || 0;
      v.base = Number(dados[`recurso.${chave}.base`] ?? v.base) || 0;
      v.recAtributo = dados[`recurso.${chave}.recAtributo`] ?? v.recAtributo;
      v.recPorPonto = Number(dados[`recurso.${chave}.recPorPonto`] ?? v.recPorPonto) || 0;
    }
    for (const [chave, v] of Object.entries(d.racas)) {
      v.label = dados[`raca.${chave}.label`] ?? v.label;
      v.nome = dados[`raca.${chave}.nome`] ?? v.nome;
      v.potencial = dados[`raca.${chave}.potencial`] ?? v.potencial;
      // Faixa de tamanho: guardada crua, inclusive se o mestre inverter as
      // pontas. Quem lê (PYRO.faixaTamanho) sabe desentortar.
      v.tamanhoMin = dados[`raca.${chave}.tamanhoMin`] ?? v.tamanhoMin;
      v.tamanhoMax = dados[`raca.${chave}.tamanhoMax`] ?? v.tamanhoMax;
      v.magia = !!dados[`raca.${chave}.magia`];
      v.feiticos = !!dados[`raca.${chave}.feiticos`];
      v.detalhe = !!dados[`raca.${chave}.detalhe`];
      v.custom = !!dados[`raca.${chave}.custom`];
      const concedidos = Object.keys(d.recursos)
        .filter(rk => dados[`raca.${chave}.recursos.${rk}`]);
      if (Object.keys(d.recursos).length) v.recursos = concedidos;
    }
    return d;
  }

  static #adicionarLingua() {
    const d = this.#capturar();
    let n = Object.keys(d.linguas).length + 1;
    while (d.linguas[`lingua${n}`]) n++;
    d.linguas[`lingua${n}`] = { label: `lingua${n}`, povo: `lingua${n}`, fator: 1, efeito: 1 };
    this.render();
  }

  static #removerLingua(event, target) {
    const d = this.#capturar();
    delete d.linguas[target.dataset.chave];
    this.render();
  }

  static #adicionarRaca() {
    const d = this.#capturar();
    let n = Object.keys(d.racas).length + 1;
    while (d.racas[`raca${n}`]) n++;
    const rotulo = game.i18n.localize("PYRO.Config.RacaNova");
    const ordem = Object.keys(PYRO.tamanhos);
    d.racas[`raca${n}`] = {
      label: rotulo, nome: rotulo, potencial: Object.keys(d.linguas)[0] ?? "humana",
      magia: false, feiticos: false, detalhe: false, custom: true,
      // Raça nova nasce sem trava: o mestre estreita a faixa se quiser.
      tamanhoMin: ordem[0], tamanhoMax: ordem[ordem.length - 1]
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
    let n = Object.keys(d.recursos).length + 1;
    while (d.recursos[`recurso${n}`]) n++;
    d.recursos[`recurso${n}`] = {
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

  static async #restaurar() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PYRO.Config.Restaurar") },
      content: `<p>${game.i18n.localize("PYRO.Config.RestaurarAviso")}</p>`
    });
    if (!ok) return;
    this.#dados = {
      linguas: foundry.utils.deepClone(PYRO.linguasPadrao),
      racas: foundry.utils.deepClone(PYRO.racasPadrao),
      recursos: foundry.utils.deepClone(PYRO.recursosCustomPadrao)
    };
    this.render();
  }

  static async #salvar() {
    const d = this.#capturar();
    await game.settings.set("pyro", "linguas", d.linguas);
    await game.settings.set("pyro", "racas", d.racas);
    await game.settings.set("pyro", "recursosCustom", d.recursos);
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
