import { PYRO } from "../config.mjs";
import { ConstrutorEfeitoApp } from "./../apps/construtor-efeito.mjs";
import { scalingsPadrao, valorScaling } from "../magia.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

export class PyroItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pyro", "item"],
    position: { width: 620, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      adicionarDano: PyroItemSheet.#adicionarDano,
      removerDano: PyroItemSheet.#removerDano,
      adicionarScaling: PyroItemSheet.#adicionarScaling,
      restaurarScalings: PyroItemSheet.#restaurarScalings,
      removerScaling: PyroItemSheet.#removerScaling,
      adicionarScalingMagia: PyroItemSheet.#adicionarScalingMagia,
      removerScalingMagia: PyroItemSheet.#removerScalingMagia,
      adicionarAfinidade: PyroItemSheet.#adicionarAfinidade,
      removerAfinidade: PyroItemSheet.#removerAfinidade,
      criarEfeito: PyroItemSheet.#criarEfeito,
      editarEfeito: PyroItemSheet.#editarEfeito,
      excluirEfeito: PyroItemSheet.#excluirEfeito,
      alternarEfeito: PyroItemSheet.#alternarEfeito
    }
  };

  /*
   * Três abas: Descrição abre por padrão porque na maior parte do tempo se
   * quer ler o item, não editá-lo. Funcionamento reúne os campos agrupados
   * por bloco, e Efeitos é a lista de Active Effects.
   */
  static PARTS = {
    cabecalho: { template: "systems/pyro/templates/item/cabecalho.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    descricao: { template: "systems/pyro/templates/item/tab-descricao.hbs" },
    funcionamento: { template: "systems/pyro/templates/item/tab-funcionamento.hbs" },
    efeitos: { template: "systems/pyro/templates/item/tab-efeitos.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "descricao", icon: "fa-solid fa-align-left" },
        { id: "funcionamento", icon: "fa-solid fa-sliders" },
        { id: "efeitos", icon: "fa-solid fa-bolt" }
      ],
      initial: "descricao",
      labelPrefix: "PYRO.ItemTabs"
    }
  };

  async _preparePartContext(partId, context) {
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /* ---------------------------------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const actor = item.actor;
    const s = item.system;

    /* --- Runas: elementos têm subtipo (limitado pelas afinidades do mago); */
    /* --- formas e modificadores são gestos de texto livre.                  */
    const ehElemento = item.type === "runa" && s.tipoRuna === "elemento";
    let subtipos = null;
    if (ehElemento) {
      subtipos = Object.fromEntries(Object.entries(PYRO.elementos).map(([k, v]) => [k, v.label]));
      const permitidos = new Set(actor?.system.afinidadesElementos ?? []);
      if (permitidos.size) {
        permitidos.add(s.subtipo); // mantém o valor atual visível
        subtipos = Object.fromEntries(
          Object.entries(subtipos).filter(([k]) => permitidos.has(k))
        );
      }
    }

    /* --- Caminho: dropdown com os caminhos do ator (valor = id) ----------- */
    let caminhoOpts = null;
    if (item.type === "habilidade" && actor) {
      caminhoOpts = { geral: game.i18n.localize("PYRO.CaminhoGeral") };
      for (const c of actor.items.filter(i => i.type === "caminho")) {
        caminhoOpts[c.id] = c.name;
      }
      // Fichas antigas guardavam o nome do caminho; mantém a opção visível.
      if (s.caminho && !(s.caminho in caminhoOpts)) caminhoOpts[s.caminho] = s.caminho;
    }

    // Habilidade de caminho com recurso próprio pode morar na aba dele.
    let rotuloAbaCaminho = null;
    if (item.type === "habilidade" && actor) {
      const dono = actor.items.get(s.caminho)
        ?? actor.items.find(i => i.type === "caminho" && i.name === s.caminho);
      const temRecurso = (dono?.system.recursos ?? []).some(r => PYRO.recursosCustom?.[r]);
      if (temRecurso) {
        const base = (dono.system.ehRacial
          ? dono.system.racaDetalhe : dono.system.nomeCaminho)?.trim();
        rotuloAbaCaminho = base
          ? game.i18n.format("PYRO.CaminhoNome", { nome: base })
          : dono.name;
      }
    }

    /* --- Caminho racial: só o primeiro define o tamanho ------------------- */
    const ehRacial = item.type === "caminho" && s.ehRacial;
    const ehPrimeiroRacial = ehRacial
      && (!actor || actor.system.primeiroRacialId === item.id || actor.system.primeiroRacialId === null);

    Object.assign(context, {
      item,
      system: s,
      systemFields: s.schema.fields,
      config: PYRO,
      subtipos,
      caminhoOpts,
      tiposDano: Object.fromEntries(Object.entries(PYRO.tiposDano).map(([k, v]) => [k, v.label])),
      linguaOpts: Object.fromEntries(Object.entries(PYRO.linguas).map(([k, v]) => [k, v.label])),
      racaOpts: Object.fromEntries(Object.entries(PYRO.racas).map(([k, v]) => [k, game.i18n.localize(v.label)])),
      // Checkboxes de magia/feitiçaria só em caminhos de profissão/classe e
      // em raças abertas — nas raças fechadas o preset já define.
      mostrarChecksMagia: item.type === "caminho"
        && (!s.ehRacial || (PYRO.racas[s.raca]?.custom ?? true)),
      tamanhoOpts: Object.fromEntries(Object.entries(PYRO.tamanhos).map(([k, v]) => [k, v.label])),
      ehRacial,
      ehPrimeiroRacial,
      ehElemento,
      rotuloPalavra: ehElemento || item.type !== "runa" ? "PYRO.Item.Palavra" : "PYRO.Item.Gesto",
      afinidadeOpts: Object.fromEntries(Object.entries(PYRO.afinidades).map(([k, v]) => [k, v.label])),
      potencialOpts: Object.fromEntries(Object.entries(PYRO.linguas).map(([k, v]) => [k, v.povo ?? v.label])),
      // Recursos personalizados que este caminho pode conceder.
      rotuloAbaCaminho,
      // Em raças fechadas o preset define os recursos: nada de checkbox.
      mostrarChecksRecursos: item.type === "caminho"
        && (!s.ehRacial || (PYRO.racas[s.raca]?.custom ?? true)),
      recursosOpts: Object.entries(PYRO.recursosCustom ?? {}).map(([chave, cfg]) => ({
        chave,
        label: game.i18n.localize(cfg.label),
        marcado: (s.recursos ?? []).includes(chave)
      })),
      tipoCustoOpts: PYRO.tiposCusto,
      // Caminhos e runas têm nome derivado: só leitura no formulário.
      nomeAutomatico: item.type === "caminho" || item.type === "runa",
      // Munição só pode ser presa nas costas ou na cintura.
      parteMunicaoOpts: Object.fromEntries(
        PYRO.partesMunicao.map(k => [k, PYRO.partesCorpo[k]])
      ),
      efeitos: item.effects.filter(e => !e.flags?.pyro?.deUso),
      efeitosDeUso: item.effects.filter(e => e.flags?.pyro?.deUso),
      subtitulo: this.#subtitulo(),
      valoresRapidos: this.#valoresRapidos(),
      // Itens físicos compartilham peso, custo e quantidade.
      temPropriedadesFisicas: ["arma", "equipamento", "consumivel"].includes(item.type),
      // Prévia do que a runa produz nas primeiras Intenções, já com o
      // multiplicador de efeito da língua (a mesma conta da conjuração).
      previaIntencoes: [1, 2, 3, 4, 5],
      previaMult: item.type === "runa" && (PYRO.linguas[s.lingua]?.efeito ?? 1) !== 1
        ? PYRO.linguas[s.lingua].efeito : null,
      previaScalings: item.type === "runa"
        ? (s.scalings ?? []).map(sc => {
            const mult = PYRO.linguas[s.lingua]?.efeito ?? 1;
            return {
              nome: sc.nome || game.i18n.localize("PYRO.Scaling.Efeito"),
              valores: [1, 2, 3, 4, 5].map(n => {
                let v = valorScaling(sc, n);
                if (mult !== 1) v = Math.max(sc.faces > 0 ? 1 : 0, Math.floor(v * mult));
                return sc.faces > 0 ? `${Math.max(0, v)}d${sc.faces}` : v;
              })
            };
          })
        : [],
      tipoLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      pedeDetalhe: item.type === "caminho" && (PYRO.racas[s.raca]?.detalhe ?? false),
      ["is" + item.type.charAt(0).toUpperCase() + item.type.slice(1)]: true,
      descricaoHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        s.descricao, { relativeTo: item, secrets: item.isOwner }
      )
    });
    return context;
  }

  /* ---------------------------------------------------------------------- */

  /* ---------------------------------------------------------------------- */
  /*  Resumo mecânico do item                                              */
  /* ---------------------------------------------------------------------- */

  /** Linha sob o nome: o essencial do item numa frase ("2d8 cortante · 15/30m"). */
  #subtitulo() {
    const s = this.item.system;
    const loc = k => game.i18n.localize(k);
    const partes = [];

    switch (this.item.type) {
      case "arma": {
        const danos = (s.danos ?? []).filter(d => d.formula?.trim())
          .map(d => `${d.formula} ${loc(PYRO.tiposDano[d.tipo]?.label ?? d.tipo)}`);
        partes.push(...danos);
        partes.push(s.alcanceMaximo > 0
          ? `${s.alcanceMenor}/${s.alcanceMaximo}m` : `${s.alcanceMenor}m`);
        partes.push(`${s.acoes} ${loc("PYRO.AcoesAbrev")}`);
        break;
      }
      case "equipamento": {
        partes.push(loc(PYRO.partesCorpo[s.parte] ?? ""));
        for (const [cat, val] of Object.entries(s.defesas?.categorias ?? {})) {
          if (val) partes.push(`${loc(PYRO.categoriasDano[cat])} +${val}`);
        }
        for (const [tipo, val] of Object.entries(s.defesas?.tipos ?? {})) {
          if (val) partes.push(`${loc(PYRO.tiposDano[tipo].label)} +${val}`);
        }
        break;
      }
      case "consumivel": {
        if (s.municao) partes.push(loc("PYRO.Item.MunicaoTag"));
        if (s.formula) {
          partes.push(s.municao
            ? `${s.formula} ${loc(PYRO.tiposDano[s.tipoDano]?.label ?? "")}`
            : s.formula);
        }
        break;
      }
      case "habilidade": {
        partes.push(loc(PYRO.categoriasHabilidade[s.categoria] ?? ""));
        partes.push(`${loc("PYRO.Item.Tier")} ${s.tier}`);
        if (s.custoAcoes) {
          partes.push(`${s.custoAcoes} ${loc(`PYRO.Item.Abrev.${s.tipoCusto}`)}`);
        }
        if (s.custoEstamina) partes.push(`${s.custoEstamina} ${loc("PYRO.Abrev.estamina")}`);
        if (s.custoMana) partes.push(`${s.custoMana} ${loc("PYRO.Abrev.mana")}`);
        if (s.custoEnergia) partes.push(`${s.custoEnergia} ${loc("PYRO.Abrev.energia")}`);
        break;
      }
      case "feitico": {
        if (s.custoAcoes) partes.push(`${s.custoAcoes} ${loc("PYRO.AcoesAbrev")}`);
        if (s.formula) partes.push(s.formula);
        break;
      }
      case "runa": {
        partes.push(loc(PYRO.tiposRuna[s.tipoRuna] ?? ""));
        if (s.tipoRuna === "elemento") {
          partes.push(loc(PYRO.elementos[s.subtipo]?.label ?? ""));
        }
        partes.push(loc(PYRO.linguas[s.lingua]?.label ?? ""));
        break;
      }
      case "magia": {
        partes.push(...(s.runas ?? []).map(r => r.nome));
        break;
      }
      case "caminho": {
        partes.push(loc(s.ehRacial ? "PYRO.Item.EhRacial" : "PYRO.Caminhos.profissaoClasse"));
        if (s.usaMagia) partes.push(loc("PYRO.Item.UsaMagia"));
        if (s.usaFeiticaria) partes.push(loc("PYRO.Item.UsaFeiticaria"));
        break;
      }
    }
    return partes.filter(Boolean).join(" · ");
  }

  /** Coluna estreita ao lado da descrição: o que se consulta sem editar. */
  #valoresRapidos() {
    const s = this.item.system;
    const loc = k => game.i18n.localize(k);
    const linhas = [];
    const add = (label, valor) => linhas.push({ label: loc(label), valor });

    if ("quantidade" in s) add("PYRO.Quantidade", s.quantidade);
    if ("peso" in s) {
      add("PYRO.Peso", s.municao ? `${s.peso} (${loc("PYRO.Item.PesoLote")})` : s.peso);
    }
    if ("custo" in s) add("PYRO.Item.Custo", s.custo);
    if ("equipado" in s) {
      add("PYRO.Item.Equipado", loc(s.equipado ? "PYRO.Sim" : "PYRO.Nao"));
    }
    if (this.item.type === "arma") {
      add("PYRO.Item.Maos", s.maos);
      add("PYRO.Item.UsaMunicao", loc(s.usaMunicao ? "PYRO.Sim" : "PYRO.Nao"));
    }
    if (this.item.type === "habilidade") {
      add("PYRO.Item.CustoXp", s.ehBase ? loc("PYRO.Item.BaseTag") : s.custoXp);
    }
    if (this.item.type === "caminho") {
      add("PYRO.Item.Xp", `${s.xpDisponivel} / ${s.xp}`);
      add("PYRO.Item.XpGasta", s.xpGasta);
      add("PYRO.ProximoCusto", s.proximoCusto);
    }
    return linhas;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * expandObject transforma inputs indexados (system.tiposDano.0,
   * system.runas.1.scalings.0.base) em objetos com chaves numéricas.
   * Reconstitui os arrays antes do update, senão os ArrayFields quebram.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const sys = data.system ?? {};

    if (this.item.type === "arma" && sys.danos && !Array.isArray(sys.danos)) {
      sys.danos = Object.values(sys.danos).map(d => ({
        formula: d.formula ?? "", tipo: d.tipo ?? "impacto"
      }));
    }

    if (this.item.type === "caminho" && sys.recursos && !Array.isArray(sys.recursos)) {
      // Checkboxes chegam como { chave: true/false }.
      sys.recursos = Object.entries(sys.recursos).filter(([, v]) => v).map(([k]) => k);
    }

    if (this.item.type === "caminho" && sys.afinidades && !Array.isArray(sys.afinidades)) {
      sys.afinidades = Object.values(sys.afinidades).map(a => ({
        tipo: a.tipo ?? "fogo",
        outro: a.outro ?? ""
      }));
    }

    if (this.item.type === "runa" && sys.scalings && !Array.isArray(sys.scalings)) {
      const atuais = this.item.system.toObject().scalings;
      sys.scalings = Object.values(sys.scalings)
        .map((sc, i) => ({ ...(atuais[i] ?? {}), ...sc }));
    }

    if (this.item.type === "magia" && sys.runas && !Array.isArray(sys.runas)) {
      const atuais = this.item.system.toObject().runas;
      const form = sys.runas;
      sys.runas = atuais.map((base, i) => {
        const r = form[i] ?? {};
        let scalings = base.scalings ?? [];
        if (r.scalings && !Array.isArray(r.scalings)) {
          scalings = Object.values(r.scalings).map((sc, j) => ({ ...(scalings[j] ?? {}), ...sc }));
        }
        return { ...base, ...r, scalings };
      });
    }

    return data;
  }

  /* ---------------------------------------------------------------------- */
  /*  Actions de arrays                                                     */
  /* ---------------------------------------------------------------------- */

  static async #adicionarDano() {
    const arr = this.item.system.toObject().danos;
    arr.push({ formula: "1d6", tipo: "impacto" });
    await this.item.update({ "system.danos": arr });
  }

  static async #removerDano(event, target) {
    const arr = this.item.system.toObject().danos;
    arr.splice(Number(target.dataset.index), 1);
    if (!arr.length) arr.push({ formula: "1d6", tipo: "impacto" });
    await this.item.update({ "system.danos": arr });
  }

  static async #adicionarScaling() {
    const arr = this.item.system.toObject().scalings;
    arr.push({ nome: "", base: 0, porIntencao: 0, faces: 0 });
    await this.item.update({ "system.scalings": arr });
  }

  /**
   * Repõe o que as regras dão para este elemento ou gesto. Serve quando o
   * jogador mexeu demais nos números ou quando o mestre editou as tabelas.
   */
  static async #restaurarScalings() {
    await this.item.update({ "system.scalings": scalingsPadrao(this.item) });
  }

  static async #removerScaling(event, target) {
    const arr = this.item.system.toObject().scalings;
    arr.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.scalings": arr });
  }

  /**
   * Linha nova nos efeitos de uma runa da magia. Se a runa ainda não tinha
   * cópia própria, os escalonamentos atuais dela entram primeiro — adicionar
   * uma linha não pode apagar o comportamento que já valia.
   */
  static async #adicionarScalingMagia(event, target) {
    const runas = this.item.system.toObject().runas;
    const r = runas[Number(target.dataset.runa)];
    if (!r) return;
    if (!r.scalings.length) {
      const runa = this.item.actor?.items.get(r.itemId)
        ?? this.item.actor?.items.find(i => i.type === "runa" && i.name === r.nome);
      r.scalings = foundry.utils.deepClone(runa?.system.toObject().scalings ?? []);
    }
    r.scalings.push({ nome: "", base: 0, porIntencao: 0, faces: 0 });
    await this.item.update({ "system.runas": runas });
  }

  static async #removerScalingMagia(event, target) {
    const runas = this.item.system.toObject().runas;
    const r = runas[Number(target.dataset.runa)];
    if (!r) return;
    r.scalings.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.runas": runas });
  }

  static async #adicionarAfinidade() {
    const arr = this.item.system.toObject().afinidades;
    arr.push({ tipo: "fogo", outro: "" });
    await this.item.update({ "system.afinidades": arr });
  }

  static async #removerAfinidade(event, target) {
    const arr = this.item.system.toObject().afinidades;
    arr.splice(Number(target.dataset.index), 1);
    await this.item.update({ "system.afinidades": arr });
  }

  /* --- Active Effects no item (transferem pro ator dono) ----------------- */

  static #criarEfeito() {
    new ConstrutorEfeitoApp({ documento: this.item }).render(true);
  }

  static #editarEfeito(event, target) {
    this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId)?.sheet.render(true);
  }

  static async #excluirEfeito(event, target) {
    await this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId)?.delete();
  }

  static async #alternarEfeito(event, target) {
    const ef = this.item.effects.get(target.closest("[data-effect-id]")?.dataset.effectId);
    if (ef) await ef.update({ disabled: !ef.disabled });
  }
}
