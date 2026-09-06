/**
 * Regras opcionais (só para o mestre): um interruptor por regra que o SRD
 * marca como opcional. A lista vem de PYRO.regrasOpcionais.
 */
import { PYRO } from "../config.mjs";
import { SYSTEM_ID, caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ConfigRegrasApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-regras",
    classes: ["pyro", "config-magia", "config-regras"],
    tag: "form",
    position: { width: 560, height: "auto" },
    window: { title: "PYRO.Regras.Nome", resizable: true },
    form: { handler: ConfigRegrasApp.#salvar, closeOnSubmit: true }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/config-regras.hbs") }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const ativas = game.settings.get(SYSTEM_ID, "regrasOpcionais") ?? {};
    context.regras = Object.entries(PYRO.regrasOpcionais).map(([chave, cfg]) => ({
      chave,
      label: game.i18n.localize(cfg.label),
      dica: game.i18n.localize(cfg.dica),
      srd: cfg.srd,
      ativa: !!ativas[chave]
    }));
    return context;
  }

  static async #salvar(event, form, formData) {
    const marcadas = formData.object;
    const regras = Object.fromEntries(
      Object.keys(PYRO.regrasOpcionais).map(chave => [chave, !!marcadas[`regra.${chave}`]])
    );
    await game.settings.set(SYSTEM_ID, "regrasOpcionais", regras);
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
