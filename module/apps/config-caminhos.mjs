import { PYRO } from "../config.mjs";
import { SYSTEM_ID, caminho } from "../sistema.mjs";

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
    form: { template: caminho("templates/apps/config-caminhos.hbs") }
  };

  /** Cópia de trabalho: só grava no submit. */
  #dados = null;

  #carregar() {
    this.#dados ??= {
      linguas: foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "linguas")),
      racas: foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "racas")),
      recursos: foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "recursosCustom")),
      // As quatro densidades são fixas; o padrão por baixo garante que uma
      // configuração antiga não deixe nenhuma sem multiplicador.
      densidades: foundry.utils.mergeObject(
        foundry.utils.deepClone(PYRO.densidadesPadrao),
        game.settings.get(SYSTEM_ID, "densidades") ?? {},
        { inplace: false })
    };
    return this.#dados;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const config = this.#carregar();

    context.linguas = Object.entries(config.linguas).map(([chave, v]) => ({
      chave, ...v,
      label: game.i18n.localize(v.label),
      povo: game.i18n.localize(v.povo ?? v.label)
    }));
    context.racas = Object.entries(config.racas).map(([chave, v]) => ({
      chave, ...v,
      label: game.i18n.localize(v.label),
      nome: game.i18n.localize(v.nome ?? v.label)
    }));
    context.recursos = Object.entries(config.recursos).map(([chave, v]) => ({
      chave, ...v, label: game.i18n.localize(v.label)
    }));
    context.densidades = Object.entries(config.densidades).map(([chave, v]) => ({
      chave, ...v, label: game.i18n.localize(PYRO.densidadesPadrao[chave]?.label ?? chave)
    }));
    context.atributos = Object.fromEntries(
      Object.entries(PYRO.atributos).map(([k, v]) => [k, game.i18n.localize(v)])
    );
    context.atributosOpcionais = {
      "": game.i18n.localize("PYRO.Config.SemRecuperacao"),
      ...context.atributos
    };
    context.potenciais = Object.fromEntries(
      Object.entries(config.linguas).map(([k, v]) => [k, game.i18n.localize(v.povo ?? v.label)])
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
    const config = this.#carregar();

    for (const [chave, lingua] of Object.entries(config.linguas)) {
      lingua.label = dados[`lingua.${chave}.label`] ?? lingua.label;
      lingua.povo = dados[`lingua.${chave}.povo`] ?? lingua.povo;
      lingua.fator = Number(dados[`lingua.${chave}.fator`] ?? lingua.fator) || 1;
      lingua.efeito = Number(dados[`lingua.${chave}.efeito`] ?? lingua.efeito) || 1;
    }
    for (const [chave, recurso] of Object.entries(config.recursos)) {
      recurso.label = dados[`recurso.${chave}.label`] ?? recurso.label;
      recurso.formula = dados[`recurso.${chave}.formula`] ?? recurso.formula;
      recurso.recAtributo = dados[`recurso.${chave}.recAtributo`] ?? recurso.recAtributo;
      recurso.recPorPonto =
        Number(dados[`recurso.${chave}.recPorPonto`] ?? recurso.recPorPonto) || 0;
    }
    for (const [chave, densidade] of Object.entries(config.densidades)) {
      const numero = campo => {
        const n = Number(dados[`densidade.${chave}.${campo}`]);
        return Number.isFinite(n) ? Math.max(0, n) : densidade[campo];
      };
      densidade.multRecuperacao = numero("multRecuperacao");
      densidade.multAlcance = numero("multAlcance");
    }
    for (const [chave, raca] of Object.entries(config.racas)) {
      raca.label = dados[`raca.${chave}.label`] ?? raca.label;
      raca.nome = dados[`raca.${chave}.nome`] ?? raca.nome;
      raca.potencial = dados[`raca.${chave}.potencial`] ?? raca.potencial;
      // Faixa de tamanho: guardada crua, inclusive se o mestre inverter as
      // pontas. Quem lê (PYRO.faixaTamanho) sabe desentortar.
      raca.tamanhoMin = dados[`raca.${chave}.tamanhoMin`] ?? raca.tamanhoMin;
      raca.tamanhoMax = dados[`raca.${chave}.tamanhoMax`] ?? raca.tamanhoMax;
      raca.magia = !!dados[`raca.${chave}.magia`];
      raca.feiticos = !!dados[`raca.${chave}.feiticos`];
      raca.detalhe = !!dados[`raca.${chave}.detalhe`];
      raca.custom = !!dados[`raca.${chave}.custom`];
      const concedidos = Object.keys(config.recursos)
        .filter(rk => dados[`raca.${chave}.recursos.${rk}`]);
      if (Object.keys(config.recursos).length) raca.recursos = concedidos;
    }
    return config;
  }

  static #adicionarLingua() {
    const config = this.#capturar();
    let n = Object.keys(config.linguas).length + 1;
    while (config.linguas[`lingua${n}`]) n++;
    config.linguas[`lingua${n}`] = { label: `lingua${n}`, povo: `lingua${n}`, fator: 1, efeito: 1 };
    this.render();
  }

  static #removerLingua(event, target) {
    const config = this.#capturar();
    delete config.linguas[target.dataset.chave];
    this.render();
  }

  static #adicionarRaca() {
    const config = this.#capturar();
    let n = Object.keys(config.racas).length + 1;
    while (config.racas[`raca${n}`]) n++;
    const rotulo = game.i18n.localize("PYRO.Config.RacaNova");
    const ordem = Object.keys(PYRO.tamanhos);
    config.racas[`raca${n}`] = {
      label: rotulo, nome: rotulo, potencial: Object.keys(config.linguas)[0] ?? "humana",
      magia: false, feiticos: false, detalhe: false, custom: true,
      // Raça nova nasce sem trava: o mestre estreita a faixa se quiser.
      tamanhoMin: ordem[0], tamanhoMax: ordem[ordem.length - 1]
    };
    this.render();
  }

  static #removerRaca(event, target) {
    const config = this.#capturar();
    delete config.racas[target.dataset.chave];
    this.render();
  }

  static #adicionarRecurso() {
    const config = this.#capturar();
    let n = Object.keys(config.recursos).length + 1;
    while (config.recursos[`recurso${n}`]) n++;
    config.recursos[`recurso${n}`] = {
      label: game.i18n.localize("PYRO.Config.RecursoNovo"),
      formula: "[SAB] * 5", recAtributo: "int", recPorPonto: 1
    };
    this.render();
  }

  static #removerRecurso(event, target) {
    const config = this.#capturar();
    delete config.recursos[target.dataset.chave];
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
      recursos: foundry.utils.deepClone(PYRO.recursosCustomPadrao),
      densidades: foundry.utils.deepClone(PYRO.densidadesPadrao)
    };
    this.render();
  }

  static async #salvar() {
    const config = this.#capturar();
    await game.settings.set(SYSTEM_ID, "linguas", config.linguas);
    await game.settings.set(SYSTEM_ID, "racas", config.racas);
    await game.settings.set(SYSTEM_ID, "recursosCustom", config.recursos);
    await game.settings.set(SYSTEM_ID, "densidades", config.densidades);
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
