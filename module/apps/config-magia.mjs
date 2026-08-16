import { PYRO } from "../config.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Tabela de elementos (só para o mestre): dados de dano, tipo, grupo de
 * afinidade e o texto de efeito de cada um.
 *
 * Línguas, raças e recursos moravam aqui e foram para a tela de Caminhos
 * Raciais, que é onde eles fazem sentido. O arquivo mantém o nome antigo
 * porque atualizar o sistema não apaga arquivos, e um `config-magia.mjs`
 * órfão no disco seria pior que um nome menos preciso.
 */
export class ConfigElementosApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "pyro-config-elementos",
    classes: ["pyro", "config-magia"],
    tag: "form",
    position: { width: 720, height: 700 },
    window: { title: "PYRO.Config.Nome", resizable: true },
    form: { handler: ConfigElementosApp.#salvar, closeOnSubmit: true },
    actions: {
      adicionarElemento: ConfigElementosApp.#adicionarElemento,
      removerElemento: ConfigElementosApp.#removerElemento,
      restaurar: ConfigElementosApp.#restaurar
    }
  };

  static PARTS = {
    form: { template: "systems/pyro/templates/apps/config-magia.hbs" }
  };

  /** Cópia de trabalho: só grava no submit. */
  #dados = null;

  #carregar() {
    this.#dados ??= foundry.utils.deepClone(game.settings.get("pyro", "elementos"));
    return this.#dados;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const elementos = this.#carregar();

    context.elementos = Object.entries(elementos).map(([chave, v]) => ({
      chave, ...v,
      label: game.i18n.localize(v.label),
      efeito: game.i18n.localize(v.efeito ?? "")
    }));
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
    // devolve as chaves "elemento.fogo.base" usadas abaixo.
    const dados = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    const elementos = this.#carregar();

    for (const [chave, v] of Object.entries(elementos)) {
      v.label = dados[`elemento.${chave}.label`] ?? v.label;
      v.grupo = dados[`elemento.${chave}.grupo`] ?? v.grupo;
      v.tipoDano = dados[`elemento.${chave}.tipoDano`] ?? v.tipoDano;
      v.base = Number(dados[`elemento.${chave}.base`] ?? v.base) || 0;
      v.porIntencao = Number(dados[`elemento.${chave}.porIntencao`] ?? v.porIntencao) || 0;
      v.faces = Number(dados[`elemento.${chave}.faces`] ?? v.faces) || 0;
      v.efeito = dados[`elemento.${chave}.efeito`] ?? v.efeito;
      v.subjulgar = !!dados[`elemento.${chave}.subjulgar`];
    }
    return elementos;
  }

  static #adicionarElemento() {
    const elementos = this.#capturar();
    let n = Object.keys(elementos).length + 1;
    while (elementos[`elemento${n}`]) n++;
    elementos[`elemento${n}`] = {
      label: `elemento${n}`, grupo: `elemento${n}`, tipoDano: "impacto",
      base: 1, porIntencao: 1, faces: 6, efeito: "", subjulgar: false
    };
    this.render();
  }

  static #removerElemento(event, target) {
    const elementos = this.#capturar();
    delete elementos[target.dataset.chave];
    this.render();
  }

  static async #restaurar() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("PYRO.Config.Restaurar") },
      content: `<p>${game.i18n.localize("PYRO.Config.RestaurarAviso")}</p>`
    });
    if (!ok) return;
    this.#dados = foundry.utils.deepClone(PYRO.elementosPadrao);
    this.render();
  }

  static async #salvar() {
    await game.settings.set("pyro", "elementos", this.#capturar());
    ui.notifications.info(game.i18n.localize("PYRO.Config.Salvo"));
  }
}
