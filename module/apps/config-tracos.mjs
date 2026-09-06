/**
 * Tabela de traços de técnica (só para o mestre): o que cada traço rende no
 * grau 1, quanto o grau seguinte acrescenta e onde ele cabe.
 *
 * Traços ficam em configuração, e não em compêndio como as runas: eles não são
 * adicionados um a um à ficha — a técnica escolhe entre os que a mesa oferece,
 * então a lista é do mundo, não do personagem.
 */
import { PYRO } from "../config.mjs";
import { SYSTEM_ID, caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ConfigTracosApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-tracos",
    classes: ["pyro", "config-magia", "config-tracos"],
    tag: "form",
    position: { width: 760, height: 700 },
    window: { title: "PYRO.Tracos.Nome", resizable: true },
    form: { handler: ConfigTracosApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionarTraco: ConfigTracosApp.#adicionarTraco,
      removerTraco: ConfigTracosApp.#removerTraco,
      restaurar: ConfigTracosApp.#restaurar
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/config-tracos.hbs") }
  };

  /** Cópias de trabalho: só gravam no submit. */
  #dados = null;
  #onus = null;

  #carregar() {
    this.#dados ??= foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "tracosTecnica"));
    return this.#dados;
  }

  #carregarOnus() {
    this.#onus ??= foundry.utils.deepClone(game.settings.get(SYSTEM_ID, "onusTecnica"));
    return this.#onus;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tracos = this.#carregar();
    const loc = k => game.i18n.localize(k);

    context.tracos = Object.entries(tracos).map(([chave, cfg]) => ({
      chave, ...cfg,
      // O nome vem do arquivo de idioma nos traços do SRD; um traço criado
      // aqui não tem chave de tradução, e aí o próprio texto é o nome.
      label: loc(cfg.label ?? chave),
      unidade: loc(cfg.unidade ?? ""),
      // As ações base em que o traço cabe; vazio aceita todas.
      bases: (cfg.bases ?? []).join(", "),
      // Comportamento no código: quem tem é traço do SRD, e o campo fica
      // visível para o mestre saber que aquele traço faz mais que somar.
      regra: cfg.regra ?? ""
    }));

    context.grupos = {
      ofensivo: loc("PYRO.Tecnica.Grupo.ofensivo"),
      mobilidade: loc("PYRO.Tecnica.Grupo.mobilidade"),
      defesa: loc("PYRO.Tecnica.Grupo.defesa")
    };
    context.onus = Object.entries(this.#carregarOnus()).map(([chave, cfg]) => ({
      chave, pontos: cfg.pontos, label: loc(cfg.label ?? chave)
    }));
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /** Lê o formulário na cópia de trabalho antes de re-renderizar. */
  #capturar() {
    const dados = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    const tracos = this.#carregar();

    for (const [chave, cfg] of Object.entries(tracos)) {
      cfg.label = dados[`traco.${chave}.label`] ?? cfg.label;
      cfg.grupo = dados[`traco.${chave}.grupo`] ?? cfg.grupo;
      cfg.base = Number(dados[`traco.${chave}.base`] ?? cfg.base) || 0;
      cfg.porGrau = Number(dados[`traco.${chave}.porGrau`] ?? cfg.porGrau) || 0;
      cfg.unidade = dados[`traco.${chave}.unidade`] ?? cfg.unidade;
      const bases = dados[`traco.${chave}.bases`];
      if (bases !== undefined) {
        cfg.bases = String(bases).split(",").map(b => b.trim()).filter(Boolean);
      }
    }

    for (const [chave, cfg] of Object.entries(this.#carregarOnus())) {
      const pontos = dados[`onus.${chave}.pontos`];
      if (pontos !== undefined) cfg.pontos = Number(pontos) || 0;
    }
    return tracos;
  }

  static #adicionarTraco() {
    const tracos = this.#capturar();
    let n = Object.keys(tracos).length + 1;
    while (tracos[`traco${n}`]) n++;
    tracos[`traco${n}`] = {
      label: `traco${n}`, grupo: "ofensivo", base: 1, porGrau: 1, unidade: "", bases: []
    };
    this.render();
  }

  static #removerTraco(event, target) {
    const tracos = this.#capturar();
    delete tracos[target.dataset.chave];
    this.render();
  }

  static async #restaurar() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PYRO.Config.Restaurar") },
      content: `<p>${game.i18n.localize("PYRO.Config.RestaurarAviso")}</p>`
    });
    if (!ok) return;
    this.#dados = foundry.utils.deepClone(PYRO.tracosTecnicaPadrao);
    this.#onus = foundry.utils.deepClone(PYRO.onusTecnicaPadrao);
    this.render();
  }

  static async #salvar() {
    const tracos = this.#capturar();
    await game.settings.set(SYSTEM_ID, "tracosTecnica", tracos);
    await game.settings.set(SYSTEM_ID, "onusTecnica", this.#carregarOnus());
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
