import { PYRO } from "../config.mjs";
import { variaveisDoItem } from "../magia.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Primeira linha de qualquer efeito novo: somar 1 ao bônus de Força. O alvo
 * sai da própria tabela de alvos, e não escrito à mão, para não apontar para
 * um campo que saiu da lista.
 */
const mudancaPadrao = () => ({
  categoria: "atributos",
  alvo: Object.keys(PYRO.alvosEfeito.atributos.alvos)[0],
  modo: "add",
  valor: "1"
});

/** Itens cujo efeito quase sempre é para o alvo, não para quem carrega. */
const TIPOS_DE_USO = ["magia", "runa", "feitico", "consumivel"];

/** Tipos que podem receber um efeito preso ("só vale com a katana"). */
const TIPOS_RESTRINGIVEIS = ["arma", "equipamento", "consumivel", "habilidade", "feitico", "magia", "runa"];

/**
 * Criação guiada de Active Effects: em vez de digitar caminhos como
 * "system.atributos.for.bonus", o jogador escolhe categoria e alvo em listas.
 * Depois de criado, o efeito continua editável pela ficha padrão do Foundry.
 */
export class ConstrutorEfeitoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ documento, categoria = "passivos", ...options } = {}) {
    super(options);
    this.documento = documento;
    this.categoria = categoria;
    /*
     * Estado de trabalho do formulário. Fica aqui e não só no DOM porque a
     * janela se re-renderiza a cada linha adicionada ou categoria trocada, e
     * o que já tinha sido digitado precisa sobreviver a isso.
     */
    this.nome = game.i18n.localize("PYRO.Efeitos.Novo");
    this.rodadas = categoria === "temporarios" ? "1" : "0";
    this.deUso = documento instanceof Item && TIPOS_DE_USO.includes(documento.type);
    /** Ids dos itens a que o efeito fica preso. Vazio = vale sempre. */
    this.alvosItem = [];
    /** Tipos inteiros presos ("todas as magias"), pelo nome do tipo de item. */
    this.alvosTipo = [];
    this.mudancas = [mudancaPadrao()];
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
      inserirVariavel: ConstrutorEfeitoApp.#inserirVariavel,
      avancado: ConstrutorEfeitoApp.#avancado
    }
  };

  static PARTS = {
    form: { template: "systems/pyro/templates/apps/construtor-efeito.hbs" }
  };

  /* ---------------------------------------------------------------------- */

  /**
   * Variáveis que o card deste item vai publicar. Em magia e runa são os
   * escalonamentos (alcance, raio, dano rolado) mais a Intenção e o mana
   * gastos; nos demais itens, só o que o card já grava nas flags.
   */
  #variaveis() {
    const item = this.documento instanceof Item ? this.documento : null;
    if (!item) return [];
    if (["magia", "runa"].includes(item.type)) return variaveisDoItem(item);
    return ["danoTotal", "cura"];
  }

  /** O ator dono, seja o efeito criado na ficha dele ou num item dele. */
  get #ator() {
    return this.documento instanceof Actor ? this.documento : this.documento?.actor ?? null;
  }

  /**
   * Itens que podem receber a restrição, agrupados por tipo. Cada grupo tem a
   * própria marcação: marcar "Magia" prende o efeito a todas as magias, sem
   * precisar caçar uma a uma e sem quebrar quando uma nova for criada.
   *
   * Sem ator não há lista: um item solto no mundo não sabe com o que ele
   * conviveria.
   */
  #itensAlvo() {
    const ator = this.#ator;
    if (!ator) return [];
    const grupos = new Map();
    for (const item of ator.items) {
      if (!TIPOS_RESTRINGIVEIS.includes(item.type)) continue;
      if (!grupos.has(item.type)) grupos.set(item.type, []);
      grupos.get(item.type).push({
        id: item.id,
        nome: item.name,
        marcado: this.alvosItem.includes(item.id)
      });
    }
    // Ordem dos tipos igual à da constante, para a lista não dançar.
    return TIPOS_RESTRINGIVEIS.filter(t => grupos.has(t)).map(tipo => ({
      tipo,
      label: game.i18n.localize(`TYPES.Item.${tipo}`),
      todos: this.alvosTipo.includes(tipo),
      itens: grupos.get(tipo).sort((a, b) => a.nome.localeCompare(b.nome))
    }));
  }

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
    context.nome = this.nome;
    context.rodadas = this.rodadas;
    context.variaveis = this.#variaveis();
    context.itensAlvo = this.#itensAlvo();
    context.mudancas = this.mudancas.map((m, i) => ({
      ...m,
      index: i,
      // Condição não tem modo nem valor: só marca o alvo com o status.
      ehCondicao: m.categoria === "condicao",
      // Dano troca o modo por uma fórmula, e o "alvo" vira o tipo do dano.
      ehDano: m.categoria === "dano",
      // Custo é sempre soma com sinal: sem escolher modo.
      ehCusto: m.categoria === "custo",
      alvos: PYRO.alvosEfeito[m.categoria]?.alvos ?? {}
    }));
    return context;
  }

  /*
   * O ouvinte de categoria fica aqui, e não em _onRender: a janela mantém o
   * mesmo elemento raiz entre renderizações, então registrar a cada uma delas
   * empilharia cópias e um clique dispararia vários re-renders.
   */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
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

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Guarda o último campo de texto tocado, para o botão de variável saber
    // onde escrever (valor de uma mudança ou a duração).
    for (const campo of this.element.querySelectorAll("input[type=text]")) {
      campo.addEventListener("focus", () => { this._ultimoCampo = campo; });
    }
    this._ultimoCampo ??= this.element.querySelector("[name$='.valor']");
  }

  /** Lê o formulário na lista de trabalho (sem gravar nada ainda). */
  #capturar() {
    const dados = foundry.utils.flattenObject(
      new foundry.applications.ux.FormDataExtended(this.element).object
    );
    this.nome = dados.nome ?? this.nome;
    this.rodadas = String(dados.rodadas ?? this.rodadas ?? "0");
    this.deUso = dados.deUso ?? this.deUso;
    // Marcações da árvore de alvos, item a item e por tipo inteiro.
    const marcados = (prefixo, chaves) =>
      chaves.filter(c => dados[`${prefixo}.${c}`]);
    const grupos = this.#itensAlvo();
    if (grupos.length) {
      this.alvosTipo = marcados("alvoTipo", grupos.map(g => g.tipo));
      this.alvosItem = marcados("alvoItem", grupos.flatMap(g => g.itens.map(i => i.id)));
    }
    this.mudancas = this.mudancas.map((m, i) => ({
      categoria: dados[`mudanca.${i}.categoria`] ?? m.categoria,
      alvo: dados[`mudanca.${i}.alvo`] ?? m.alvo,
      // v14: o tipo da mudança é texto ("add"), não mais um número.
      modo: String(dados[`mudanca.${i}.modo`] ?? m.modo),
      valor: dados[`mudanca.${i}.valor`] ?? m.valor
    }));
    return dados;
  }

  static #adicionarMudanca() {
    this.#capturar();
    this.mudancas.push(mudancaPadrao());
    this.render();
  }

  static #removerMudanca(event, target) {
    this.#capturar();
    this.mudancas.splice(Number(target.dataset.index), 1);
    if (!this.mudancas.length) {
      this.mudancas.push(mudancaPadrao());
    }
    this.render();
  }

  /** Escreve "@variavel" no último campo de texto em que o cursor esteve. */
  static #inserirVariavel(event, target) {
    const campo = this._ultimoCampo ?? this.element.querySelector("[name$='.valor']");
    if (!campo) return;
    const texto = `@${target.dataset.variavel}`;
    const inicio = campo.selectionStart ?? campo.value.length;
    const fim = campo.selectionEnd ?? campo.value.length;
    campo.value = campo.value.slice(0, inicio) + texto + campo.value.slice(fim);
    campo.focus();
    campo.setSelectionRange(inicio + texto.length, inicio + texto.length);
    this.#capturar();
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
    // Efeito de uso vai para o alvo ao usar o item, então não transfere
    // automaticamente para quem carrega.
    const deUso = !!dados.deUso;

    /*
     * A duração aceita fórmula ("@rodadas", "@intencao * 2"). Número puro vira
     * duração direto; fórmula fica guardada e só é resolvida quando o efeito é
     * aplicado, com as variáveis daquela conjuração.
     */
    const textoRodadas = String(dados.rodadas ?? "").trim();
    const rodadasFixas = Number(textoRodadas);
    const rodadasEhFormula = textoRodadas !== "" && !Number.isFinite(rodadasFixas);

    /*
     * Três destinos diferentes: condição vira status (marcador no token),
     * dano vira uma fórmula guardada nas flags (é rolagem, não alteração de
     * campo) e o resto vira change de Active Effect como sempre.
     */
    const condicoes = this.mudancas.filter(m => m.categoria === "condicao" && m.alvo);
    const danos = this.mudancas
      .filter(m => m.categoria === "dano" && String(m.valor ?? "").trim())
      .map(m => ({ formula: String(m.valor).trim(), tipo: m.alvo || "" }));
    const custos = this.mudancas
      .filter(m => m.categoria === "custo" && m.alvo && Number.isFinite(Number(m.valor)))
      .map(m => ({ chave: m.alvo, valor: Number(m.valor) }));
    const mudancas = this.mudancas
      .filter(m => !["condicao", "dano", "custo"].includes(m.categoria) && m.alvo);

    /*
     * A restrição guarda id e nome no item específico (o id resolve nesta
     * ficha, o nome sobrevive ao efeito ser copiado) e só o tipo no grupo
     * inteiro. Item de um tipo já marcado por inteiro não precisa repetir.
     */
    const ator = this.#ator;
    const alvosItem = [
      ...this.alvosTipo.map(tipo => ({ tipo, nome: game.i18n.localize(`TYPES.Item.${tipo}`) })),
      ...this.alvosItem
        .filter(id => !this.alvosTipo.includes(ator?.items.get(id)?.type))
        .map(id => ({ id, nome: ator?.items.get(id)?.name ?? "" }))
        .filter(a => a.nome)
    ];

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
      flags: {
        pyro: {
          deUso,
          ...(rodadasEhFormula ? { rodadasFormula: textoRodadas } : {}),
          ...(danos.length ? { danos } : {}),
          ...(custos.length ? { custos } : {}),
          ...(alvosItem.length ? { alvosItem } : {})
        }
      },
      statuses: [...new Set(condicoes.map(m => m.alvo))],
      // v14: as mudanças moram no system do efeito, com o tipo em texto.
      system: {
        changes: mudancas
          .map(m => ({ key: m.alvo, type: m.modo, value: String(m.valor ?? ""), priority: 20 }))
      }
    };
    // Fórmula entra com 1 rodada só para o efeito já nascer temporário; o
    // número real é escrito na cópia que vai para o alvo.
    if (rodadasEhFormula) efeito.duration = { rounds: 1 };
    else if (rodadasFixas > 0) efeito.duration = { rounds: rodadasFixas };

    const criados = await ActiveEffect.implementation.create(efeito, { parent: this.documento });
    return Array.isArray(criados) ? criados[0] : criados;
  }
}
