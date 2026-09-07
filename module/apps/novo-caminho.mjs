/**
 * Compra de um Caminho novo (SRD §2): custa 10 x o número de caminhos que o
 * personagem já tem, e pode ser pago com a Experiência de vários caminhos ao
 * mesmo tempo.
 *
 * A janela existe por causa desse "de vários ao mesmo tempo": o gasto não cabe
 * num campo da ficha, porque é uma repartição entre pools — quem tem 20 num
 * caminho e 15 em outro precisa dizer quanto sai de cada.
 */
import { PYRO } from "../config.mjs";
import { caminho } from "../sistema.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NovoCaminhoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ actor, ...options } = {}) {
    super(options);
    this.actor = actor;
    /** Quanto sai de cada caminho, por id. */
    this.pagamento = {};
  }

  static DEFAULT_OPTIONS = {
    id: "pyro-novo-caminho-{id}",
    classes: ["pyro", "conjurador", "novo-caminho"],
    tag: "form",
    position: { width: 520, height: "auto" },
    window: { title: "PYRO.NovoCaminho.Titulo", resizable: true },
    form: { handler: NovoCaminhoApp.#aoComprar, closeOnSubmit: false },
    actions: {
      distribuir: NovoCaminhoApp.#distribuir,
      limpar: NovoCaminhoApp.#limpar
    }
  };

  static PARTS = {
    form: { template: caminho("templates/apps/novo-caminho.hbs") }
  };

  /* ---------------------------------------------------------------------- */

  #caminhos() {
    return this.actor.items
      .filter(i => i.type === "caminho")
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const caminhos = this.#caminhos();
    const custo = PYRO.custoDoCaminhoNovo(caminhos.length);

    const fontes = caminhos.map(c => {
      const disponivel = Math.max(0, c.system.xpDisponivel ?? 0);
      return {
        id: c.id,
        nome: c.name,
        disponivel,
        // O que já foi apontado para este caminho, aparado pelo que ele tem:
        // gastar XP em habilidades com a janela aberta não pode virar dívida.
        valor: Math.min(Math.max(0, this.pagamento[c.id] ?? 0), disponivel)
      };
    });

    const somado = fontes.reduce((t, f) => t + f.valor, 0);
    const total = fontes.reduce((t, f) => t + f.disponivel, 0);
    this._podeComprar = somado === custo && custo > 0;

    Object.assign(context, {
      actor: this.actor,
      fontes,
      temFontes: fontes.length > 0,
      custo,
      somado,
      falta: Math.max(0, custo - somado),
      excedeu: somado > custo,
      total,
      semXpSuficiente: total < custo,
      custoTexto: game.i18n.format("PYRO.NovoCaminho.Custo", { custo, quantos: caminhos.length }),
      podeComprar: this._podeComprar
    });
    return context;
  }

  /** Lê os campos na cópia de trabalho antes de re-renderizar. */
  #capturarCampos() {
    for (const campo of this.element?.querySelectorAll("[name^='fonte.']") ?? []) {
      this.pagamento[campo.name.slice("fonte.".length)] = Number(campo.value) || 0;
    }
  }

  /**
   * Preenche sozinho na ordem da lista: enche o primeiro caminho até o que
   * ele tem, depois o próximo, até fechar o custo. É o rateio que a maioria
   * quer, e quem quiser outro só mexe nos números depois.
   */
  static #distribuir() {
    const caminhos = this.#caminhos();
    let falta = PYRO.custoDoCaminhoNovo(caminhos.length);
    for (const c of caminhos) {
      const usa = Math.min(falta, Math.max(0, c.system.xpDisponivel ?? 0));
      this.pagamento[c.id] = usa;
      falta -= usa;
    }
    this.render();
  }

  static #limpar() {
    this.pagamento = {};
    this.render();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const botao = this.element.querySelector("button[type=submit]");
    if (botao) botao.disabled = !this._podeComprar;
    // Mexer num campo re-renderiza para o medidor acompanhar a soma.
    for (const campo of this.element.querySelectorAll("[name^='fonte.']")) {
      campo.addEventListener("change", () => {
        this.#capturarCampos();
        this.render();
      });
    }
  }

  static async #aoComprar() {
    this.#capturarCampos();
    if (!this._podeComprar) return;

    /*
     * A XP sai como gasto registrado no próprio caminho de origem: o campo
     * `xp` é o total ganho, e descontar dele é o que mantém "disponível =
     * ganho − gasto" verdadeiro depois da compra.
     */
    const updates = [];
    for (const c of this.#caminhos()) {
      const valor = Math.min(Math.max(0, this.pagamento[c.id] ?? 0), c.system.xpDisponivel ?? 0);
      if (valor > 0) updates.push({ _id: c.id, "system.xp": c.system.xp - valor });
    }
    if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);

    const novo = await Item.implementation.create({
      name: game.i18n.localize("PYRO.NovoCaminho.NomePadrao"),
      type: "caminho"
    }, { parent: this.actor, renderSheet: true });

    ui.notifications.info(game.i18n.format("PYRO.NovoCaminho.Comprado", {
      custo: PYRO.custoDoCaminhoNovo(this.#caminhos().length - 1)
    }));
    await this.close();
    return novo;
  }
}
