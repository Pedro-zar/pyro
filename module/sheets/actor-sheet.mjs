import { PYRO } from "../config.mjs";
import { ConjuradorApp } from "../apps/conjurador.mjs";
import { GuiaAcoesApp } from "../apps/guia-acoes.mjs";
import { ConstrutorEfeitoApp } from "../apps/construtor-efeito.mjs";
import { restricaoDoEfeito } from "../efeitos.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class PyroActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["pyro", "actor"],
    position: { width: 740, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rolarAtributo: PyroActorSheet.#rolarAtributo,
      rolarEsquiva: PyroActorSheet.#rolarEsquiva,
      rolarBloqueio: PyroActorSheet.#rolarBloqueio,
      tomarAr: PyroActorSheet.#tomarAr,
      gastarVontade: PyroActorSheet.#gastarVontade,
      recuperar: PyroActorSheet.#recuperar,
      abrirRecuperacao: PyroActorSheet.#abrirRecuperacao,
      abrirConjurador: PyroActorSheet.#abrirConjurador,
      abrirGuiaAcoes: PyroActorSheet.#abrirGuiaAcoes,
      criarItem: PyroActorSheet.#criarItem,
      editarItem: PyroActorSheet.#editarItem,
      excluirItem: PyroActorSheet.#excluirItem,
      usarItem: PyroActorSheet.#usarItem,
      alternarResumo: PyroActorSheet.#alternarResumo,
      alternarEquipado: PyroActorSheet.#alternarEquipado,
      alternarFavorito: PyroActorSheet.#alternarFavorito,
      escolherVocacao: PyroActorSheet.#escolherVocacao,
      escolherCorElemento: PyroActorSheet.#escolherCorElemento,
      criarEfeito: PyroActorSheet.#criarEfeito,
      editarEfeito: PyroActorSheet.#editarEfeito,
      excluirEfeito: PyroActorSheet.#excluirEfeito,
      alternarEfeito: PyroActorSheet.#alternarEfeito
    }
  };

  /*
   * Seis abas fixas, agrupadas por atividade e não por tipo de dado. Só
   * Poderes é condicional — as seções internas é que aparecem e somem
   * conforme o personagem, o que evita a ficha mudar de forma o tempo todo.
   */
  static PARTS = {
    header: { template: "systems/pyro/templates/actor/header.hbs" },
    atributos: { template: "systems/pyro/templates/actor/atributos.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    combate: { template: "systems/pyro/templates/actor/tab-combate.hbs" },
    poderes: { template: "systems/pyro/templates/actor/tab-poderes.hbs" },
    inventario: { template: "systems/pyro/templates/actor/tab-inventario.hbs" },
    progressao: { template: "systems/pyro/templates/actor/tab-progressao.hbs" },
    notas: { template: "systems/pyro/templates/actor/tab-notas.hbs" },
    efeitos: { template: "systems/pyro/templates/actor/tab-efeitos.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "combate", icon: "fa-solid fa-hand-fist" },
        { id: "poderes", icon: "fa-solid fa-wand-sparkles" },
        { id: "inventario", icon: "fa-solid fa-box-open" },
        { id: "progressao", icon: "fa-solid fa-route" },
        { id: "notas", icon: "fa-solid fa-book" },
        { id: "efeitos", icon: "fa-solid fa-bolt" }
      ],
      initial: "combate",
      labelPrefix: "PYRO.Tabs"
    }
  };

  /* ---------------------------------------------------------------------- */

  /** Sem magia, feitiçaria nem caminho próprio, a aba Poderes não existe. */
  #abasOcultas() {
    const sys = this.actor.system;
    const temPoderes = sys.temMagia || sys.temFeiticos || sys.temAbaCaminho;
    return temPoderes ? [] : ["poderes"];
  }

  _prepareTabs(group) {
    const tabs = super._prepareTabs(group);
    if (group !== "primary") return tabs;
    for (const id of this.#abasOcultas()) {
      delete tabs[id];
      // Se a aba ativa sumiu (ex.: caminho racial trocado), volta pra Combate.
      if (this.tabGroups.primary === id && tabs.combate) {
        this.tabGroups.primary = "combate";
        tabs.combate.active = true;
        tabs.combate.cssClass = "active";
      }
    }
    return tabs;
  }

  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    const ocultas = this.#abasOcultas();
    options.parts = options.parts.filter(p => !ocultas.includes(p));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    // Ordem manual: o campo sort é mantido pelo arraste na lista.
    const porTipo = tipo => actor.items.filter(i => i.type === tipo)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const loc = k => game.i18n.localize(k);

    const armas = await this.#linhas(porTipo("arma"), item => {
      const s = item.system;
      const danos = (s.danos ?? []).filter(d => d.formula?.trim());
      const resumoDano = danos
        .map(d => `${d.formula} ${loc(PYRO.tiposDano[d.tipo]?.label ?? d.tipo)}`).join(" · ");
      const alcance = s.alcanceMaximo > 0
        ? `${s.alcanceMenor}/${s.alcanceMaximo}m` : `${s.alcanceMenor}m`;
      return {
        detalhes: [{ texto: resumoDano, classe: "col-dano" }],
        cauda: [
          { texto: s.acoes, classe: "col-curto" },
          { texto: alcance, classe: "col-curto" }
        ],
        resumo: [
          { label: loc("PYRO.Item.Dano"), valor: resumoDano || "—" },
          { label: loc("PYRO.Acoes"), valor: s.acoes },
          { label: loc("PYRO.Item.Maos"), valor: s.maos },
          { label: loc("PYRO.Item.Alcance"), valor: alcance },
          { label: loc("PYRO.Item.UsaMunicao"), valor: loc(s.usaMunicao ? "PYRO.Sim" : "PYRO.Nao") },
          { label: loc("PYRO.Peso"), valor: s.peso },
          { label: loc("PYRO.Item.Custo"), valor: s.custo },
          { label: loc("PYRO.Quantidade"), valor: s.quantidade }
        ]
      };
    });

    const equipamentos = await this.#linhas(porTipo("equipamento"), item => {
      const s = item.system;
      const defesas = [];
      for (const [cat, val] of Object.entries(s.defesas.categorias)) {
        if (val) defesas.push(`${loc(PYRO.categoriasDano[cat])} +${val}`);
      }
      for (const [tipo, val] of Object.entries(s.defesas.tipos)) {
        if (val) defesas.push(`${loc(PYRO.tiposDano[tipo].label)} +${val}`);
      }
      return {
        equipavel: true,
        equipado: s.equipado,
        detalhes: [{ texto: loc(PYRO.partesCorpo[s.parte] ?? ""), classe: "col-parte" }],
        cauda: [{ texto: s.peso, classe: "col-curto" }],
        resumo: [
          { label: loc("PYRO.Item.Parte"), valor: loc(PYRO.partesCorpo[s.parte] ?? "") },
          { label: loc("PYRO.Defesas"), valor: defesas.join(" · ") || "—" },
          { label: loc("PYRO.Bloquear"), valor: s.bloqueio || "—" },
          { label: loc("PYRO.Esquivar"), valor: s.esquiva || "—" },
          { label: loc("PYRO.Peso"), valor: s.peso },
          { label: loc("PYRO.Item.Custo"), valor: s.custo },
          { label: loc("PYRO.Quantidade"), valor: s.quantidade }
        ]
      };
    });

    const consumiveis = await this.#linhas(porTipo("consumivel"), item => {
      const s = item.system;
      const tipoDano = loc(PYRO.tiposDano[s.tipoDano]?.label ?? "");
      const detalhes = [];
      if (s.municao) {
        detalhes.push({ texto: loc("PYRO.Item.MunicaoTag"), classe: "destaque-lingua" });
        detalhes.push({ texto: tipoDano, classe: "col-curto" });
      }
      if (s.formula) detalhes.push({ texto: s.formula, classe: "" });
      // Onde a munição prende, ou o custo em ações de usar, fica no miolo.
      detalhes.push(s.municao
        ? { texto: loc(PYRO.partesCorpo[s.parte] ?? "") }
        : { texto: `${s.acoes} ${loc("PYRO.AcoesAbrev")}` });
      return {
        equipavel: s.municao,
        // Sem botão de equipar, reserva o espaço dele: a cauda alinha igual
        // nas linhas com e sem munição.
        espacoEquipar: !s.municao,
        equipado: s.equipado,
        detalhes,
        cauda: [
          { texto: s.quantidade, classe: "col-qtd" },
          { texto: s.peso, classe: "col-curto" },
          { texto: s.custo, classe: "col-curto" }
        ],
        resumo: [
          { label: loc("PYRO.Item.Formula"), valor: s.formula || "—" },
          ...(s.municao ? [{ label: loc("PYRO.Item.TipoDano"), valor: tipoDano }] : []),
          { label: loc("PYRO.Quantidade"), valor: s.quantidade },
          { label: loc("PYRO.Peso"), valor: s.peso },
          { label: loc("PYRO.Item.Custo"), valor: s.custo }
        ]
      };
    });

    const habilidade = item => {
      const s = item.system;
      const caminho = actor.items.get(s.caminho)
        ?? actor.items.find(i => i.type === "caminho" && i.name === s.caminho);
      const caminhoNome = caminho?.name
        ?? (s.caminho === "geral" ? loc("PYRO.CaminhoGeral") : s.caminho);
      const custos = [
        s.custoEstamina ? `${s.custoEstamina} ${loc("PYRO.Abrev.estamina")}` : null,
        s.custoMana ? `${s.custoMana} ${loc("PYRO.Abrev.mana")}` : null,
        s.custoEnergia ? `${s.custoEnergia} ${loc("PYRO.Abrev.energia")}` : null,
        s.custoAcoes ? `${s.custoAcoes} ${loc(`PYRO.Item.Abrev.${s.tipoCusto}`)}` : null
      ].filter(Boolean).join(" · ");
      return {
        detalhes: [
          { texto: caminhoNome, classe: "col-caminho" },
          { texto: custos, classe: "col-custo" }
        ],
        cauda: [
          { texto: loc(PYRO.categoriasHabilidade[s.categoria] ?? ""), classe: "col-categoria" },
          { texto: `T${s.tier}`, classe: "col-tier" }
        ],
        resumo: [
          { label: loc("TYPES.Item.caminho"), valor: caminhoNome },
          { label: loc("PYRO.Item.Categoria"), valor: loc(PYRO.categoriasHabilidade[s.categoria] ?? "") },
          { label: loc("PYRO.Item.Tier"), valor: s.tier },
          { label: loc("PYRO.Item.CustoXp"), valor: s.ehBase ? loc("PYRO.Item.BaseTag") : s.custoXp },
          { label: loc("PYRO.Item.Custos"), valor: custos || "—" },
          { label: loc("PYRO.Item.Formula"), valor: s.formula || "—" },
          // Ligações da árvore: de onde esta veio e em que ela foi consumida.
          ...(s.requisitosNomes
            ? [{ label: loc("PYRO.Item.Requisitos"), valor: s.requisitosNomes }] : []),
          ...(s.usadaEm ? [{ label: loc("PYRO.Item.UsadaEm"), valor: s.usadaEm }] : [])
        ]
      };
    };

    const todasHabilidades = porTipo("habilidade");
    const habilidades = await this.#linhas(
      todasHabilidades.filter(i => !i.system.ehTecnica && !i.system.abaCaminho), habilidade);
    const tecnicas = await this.#linhas(
      todasHabilidades.filter(i => i.system.ehTecnica && !i.system.abaCaminho), habilidade);
    const habilidadesCaminho = await this.#linhas(
      todasHabilidades.filter(i => i.system.abaCaminho), habilidade);

    const feiticos = await this.#linhas(porTipo("feitico"), item => {
      const s = item.system;
      return {
        detalhes: [{ texto: s.formula, classe: "" }],
        cauda: [{
          texto: s.custoAcoes || "",
          classe: "col-curto"
        }],
        resumo: [
          { label: loc("PYRO.Acoes"), valor: s.custoAcoes },
          { label: loc("PYRO.Item.Formula"), valor: s.formula || "—" }
        ]
      };
    });

    const runas = await this.#linhas(porTipo("runa"), item => {
      const s = item.system;
      const nativa = actor.system.linguaNativa;
      const subtipo = s.tipoRuna === "elemento"
        ? loc(PYRO.elementos[s.subtipo]?.label ?? "") : "";
      return {
        // Marcador lateral com a cor do elemento: ajuda a varrer a lista.
        cor: s.tipoRuna === "elemento" && PYRO.elementos[s.subtipo] ? s.subtipo : null,
        detalhes: [
          { texto: loc(PYRO.tiposRuna[s.tipoRuna] ?? ""), classe: "col-curto" },
          { texto: subtipo, classe: "" }
        ],
        cauda: [{
          texto: loc(PYRO.linguas[s.lingua]?.label ?? ""),
          classe: s.lingua !== nativa ? "col-curto destaque-lingua" : "col-curto"
        }],
        resumo: [
          { label: loc("PYRO.Item.TipoRuna"), valor: loc(PYRO.tiposRuna[s.tipoRuna] ?? "") },
          ...(subtipo ? [{ label: loc("PYRO.Item.Subtipo"), valor: subtipo }] : []),
          { label: loc("PYRO.Item.Palavra"), valor: s.palavra || "—" },
          { label: loc("PYRO.Item.Lingua"), valor: loc(PYRO.linguas[s.lingua]?.label ?? "") }
        ]
      };
    });

    const magias = await this.#linhas(porTipo("magia"), item => {
      const runasTexto = item.system.runas.map(r => r.nome).join(" · ");
      // Cores dos elementos das runas: uma vira friso, várias viram gradiente.
      const cores = [];
      for (const ref of item.system.runas) {
        const runa = actor.items.get(ref.itemId)
          ?? actor.items.find(i => i.type === "runa" && i.name === ref.nome);
        const sub = runa?.system.tipoRuna === "elemento" ? runa.system.subtipo : null;
        if (sub && PYRO.elementos[sub] && !cores.includes(sub)) cores.push(sub);
      }
      const escalas = item.system.runas.flatMap(r =>
        (r.scalings ?? []).map(sc => `${r.nome}: ${sc.nome} ${sc.base}${sc.porIntencao ? `+${sc.porIntencao}/int` : ""}${sc.faces ? `d${sc.faces}` : ""}`)
      );
      return {
        cor: cores.length === 1 ? cores[0] : null,
        // Vertical para o friso; horizontal para o lavado do hover.
        grad: cores.length > 1
          ? `linear-gradient(180deg, ${cores.map(c => `var(--pyro-el-${c})`).join(", ")})`
          : null,
        gradH: cores.length > 1
          ? `linear-gradient(90deg, ${cores.map(c => `var(--pyro-el-${c})`).join(", ")})`
          : null,
        detalhes: [{ texto: runasTexto, classe: "" }],
        resumo: [
          { label: loc("PYRO.Item.RunasDaMagia"), valor: runasTexto || "—" },
          ...(escalas.length ? [{ label: loc("PYRO.Item.ScalingNome"), valor: escalas.join(" · ") }] : [])
        ]
      };
    });

    const caminhos = await this.#linhas(porTipo("caminho"), item => {
      const s = item.system;
      const afinidades = (s.afinidades ?? [])
        .map(a => a.tipo === "outro" ? a.outro : PYRO.afinidades[a.tipo]?.label)
        .filter(Boolean).join(", ");
      const recursos = (s.recursos ?? [])
        .map(r => loc(PYRO.recursosCustom[r]?.label ?? r)).join(", ");
      return {
        detalhes: [],
        cauda: [
          {
            texto: `${loc("PYRO.Abrev.xp")} ${s.xpDisponivel}`,
            classe: "col-xp", dica: loc("PYRO.XpDisponivel")
          },
          {
            texto: `${loc("PYRO.Abrev.gasta")} ${s.xpGasta}`,
            classe: "col-xp", dica: loc("PYRO.Item.XpGasta")
          },
          {
            texto: `${loc("PYRO.Abrev.prox")} ${s.proximoCusto}`,
            classe: "col-xp", dica: loc("PYRO.ProximoCustoTooltip")
          }
        ],
        /*
         * Só o que não dá para ler em outro lugar da linha. Raça e detalhe já
         * estão no nome do caminho, logo acima; potencial mágico e curva de
         * progressão são configuração do mundo, não característica do
         * personagem. Sobra o que muda de ficha para ficha.
         */
        resumo: [
          ...(s.ehRacial ? [{ label: "", valor: loc("PYRO.Item.EhRacial") }] : []),
          { label: loc("PYRO.Item.Xp"), valor: `${s.xpDisponivel} / ${s.xp}` },
          ...(s.usaMagia
            ? [{ label: loc("PYRO.Item.Afinidades"), valor: afinidades || "—" }]
            : []),
          ...(recursos ? [{ label: loc("PYRO.Item.Concede"), valor: recursos }] : [])
        ]
      };
    });

    /*
     * Favoritos: reaproveita as linhas já montadas — o mesmo item aparece na
     * lista de origem e na seção Favoritos da aba Combate.
     */
    const favoritaveis = ["arma", "equipamento", "consumivel", "habilidade", "feitico", "magia"];
    const favIds = new Set(actor.items
      .filter(i => favoritaveis.includes(i.type) && i.getFlag("pyro", "favorito"))
      .map(i => i.id));
    const favoritos = [
      ...tecnicas, ...habilidades, ...habilidadesCaminho, ...feiticos, ...magias,
      ...armas, ...equipamentos, ...consumiveis
    ].filter(l => favIds.has(l.id));

    /*
     * Seções: cada lista carrega o próprio título, a legenda das colunas, o
     * botão de criar do tipo certo e o texto de lista vazia. Os templates só
     * repassam isso ao partial, então mudar o formato de uma linha ou de um
     * cabeçalho acontece num lugar só.
     */
    const col = (chave, classe) => ({ texto: loc(`PYRO.Col.${chave}`), classe });
    const secao = (chave, itens, extra = {}) => ({
      chave,
      titulo: loc(`PYRO.Secao.${chave}`),
      vazio: loc(`PYRO.Vazio.${chave}`),
      itens,
      ...extra
    });

    const colsHabilidade = {
      colNome: loc("PYRO.Col.habilidade"),
      colunas: [col("caminho", "col-caminho"), col("custo", "col-custo")],
      cauda: [col("tipo", "col-categoria"), col("tier", "col-tier")],
      legIcones: "leg-icones-1"
    };

    const secoes = {
      favoritos: secao("favoritos", favoritos, { semLegenda: true }),
      tecnicas: secao("tecnicas", tecnicas, colsHabilidade),
      habilidades: secao("habilidades", habilidades, colsHabilidade),
      caminhoProprio: secao("caminhoProprio", habilidadesCaminho, {
        titulo: actor.system.abaCaminhoLabel || loc("PYRO.Secao.caminhoProprio"),
        ...colsHabilidade
      }),
      armas: secao("armas", armas, {
        colNome: loc("PYRO.Col.arma"),
        colunas: [col("dano", "col-dano")],
        cauda: [col("acoes", "col-curto"), col("alcance", "col-curto")],
        legIcones: "leg-icones-1"
      }),
      equipamentos: secao("equipamentos", equipamentos, {
        colNome: loc("PYRO.Col.equipamento"),
        colunas: [col("parte", "col-parte")],
        cauda: [col("peso", "col-curto")],
        legIcones: "leg-icones-2"
      }),
      consumiveis: secao("consumiveis", consumiveis, {
        colNome: loc("PYRO.Col.consumivel"),
        cauda: [col("quantidade", "col-qtd"), col("peso", "col-curto"), col("custo", "col-curto")],
        legIcones: "leg-icones-2"
      }),
      feiticos: secao("feiticos", feiticos, {
        colNome: loc("PYRO.Col.feitico"),
        colunas: [col("formula", "")],
        cauda: [col("acoes", "col-curto")],
        legIcones: "leg-icones-1"
      }),
      magias: secao("magias", magias, {
        colNome: loc("PYRO.Col.magia"),
        colunas: [col("runas", "")]
      }),
      runas: secao("runas", runas, {
        colNome: loc("PYRO.Col.runa"),
        colunas: [col("tipo", "col-curto"), col("elemento", "")],
        cauda: [col("lingua", "col-curto")]
      }),
      caminhos: secao("caminhos", caminhos, {
        colNome: loc("PYRO.Col.caminho")
      })
    };

    const sys = actor.system;
    const { selosPoder, seloPrincipal, coresElemento } = this.#selosDePoder();

    /*
     * Barras de recurso em linhas equilibradas: até 4 por linha e as linhas
     * com quase o mesmo tamanho — 4 recursos numa linha só, 5 viram 3 + 2.
     */
    const recursosVisiveis = this.#recursosVisiveis();
    const linhasRec = Math.max(1, Math.ceil(recursosVisiveis.length / 4));
    const recursosCols = Math.max(1, Math.ceil(recursosVisiveis.length / linhasRec));

    Object.assign(context, {
      actor,
      system: actor.system,
      systemFields: actor.system.schema.fields,
      config: PYRO,
      tamanhoOpts: Object.fromEntries(Object.entries(PYRO.tamanhos).map(([k, v]) => [k, v.label])),
      secoes,
      isNpc: actor.type === "npc",
      // Botão único de criar na aba Poderes: oferece só o que o personagem usa.
      tiposPoderes: [
        actor.system.temMagia ? "runa" : null,
        actor.system.temFeiticos ? "feitico" : null
      ].filter(Boolean).join(","),
      efeitos: this.#categoriasEfeitos(),
      recursosVisiveis,
      recursosCols,
      selosPoder,
      seloPrincipal,
      coresElemento,
      podeTrocarTema: actor.isOwner,
      identidade: this.#identidade(),
      alertas: this.#alertas(),
      tamanhoLabel: loc(PYRO.tamanhos[actor.system.tamanho]?.label ?? ""),
      // Com um caminho racial, o tamanho vem dele — inclusive em NPCs.
      podeEditarTamanho: !actor.system.primeiroRacialId,
      // Defesas em modo leitura: categoria no topo, tipos dela abaixo.
      defesaColunas: [
        { categoria: "fisico", tipos: ["impacto", "cortante", "perfurante"] },
        { categoria: "energetico", tipos: ["calor", "frio", "energia"] },
        { categoria: "mental", tipos: [] }
      ].map(col => ({
        label: loc(PYRO.categoriasDano[col.categoria]),
        // Mental é categoria e tipo ao mesmo tempo: usa o total do tipo.
        total: col.tipos.length
          ? actor.system.defesas.categoriasTotais[col.categoria]
          : actor.system.defesas.totais[col.categoria],
        tipos: col.tipos.map(t => ({
          label: loc(PYRO.tiposDano[t].label),
          total: actor.system.defesas.totais[t]
        }))
      })),
      biografiaHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        actor.system.biografia, { relativeTo: actor, secrets: actor.isOwner }
      ),
      // Campos da aba Notas, todos enriquecidos de uma vez.
      notas: await this.#notasEnriquecidas(),
      notasHTML: actor.type === "npc"
        ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(
            actor.system.notas, { relativeTo: actor, secrets: actor.isOwner }
          )
        : ""
    });
    return context;
  }

  async _preparePartContext(partId, context) {
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /* ---------------------------------------------------------------------- */
  /*  Actions                                                               */
  /* ---------------------------------------------------------------------- */

  static async #rolarAtributo(event, target) {
    // Shift+clique: rolagem rápida, sem diálogo.
    await this.actor.rolarAtributo(target.dataset.atributo, { rapido: event.shiftKey });
  }

  static async #rolarEsquiva(event) {
    await this.actor.rolarEsquiva({ cobertura: event.shiftKey });
  }

  static async #rolarBloqueio(event) {
    await this.actor.rolarBloqueio({ cobertura: event.shiftKey });
  }

  static async #tomarAr() {
    await this.actor.tomarAr();
  }

  static async #gastarVontade(event, target) {
    await this.actor.gastarVontade(Number(target.dataset.pontos));
  }

  static async #recuperar(event, target) {
    const escopo = target.dataset.escopo;
    if (escopo === "cena") await this.actor.recuperarCena();
    else if (escopo === "capitulo") await this.actor.recuperarCapitulo();
    else if (escopo === "arco") await this.actor.recuperarArco();
  }

  static #abrirConjurador() {
    new ConjuradorApp({ actor: this.actor }).render(true);
  }

  static #abrirGuiaAcoes() {
    new GuiaAcoesApp().render(true);
  }

  static async #criarItem(event, target) {
    // Tipo fixo no botão: cria direto.
    let tipo = target.dataset.type;

    // Sem tipo fixo, o botão traz os tipos daquela aba e pergunta qual criar.
    if (!tipo) {
      const tipos = (target.dataset.tipos ?? "").split(",").filter(Boolean);
      if (!tipos.length) return;
      if (tipos.length === 1) tipo = tipos[0];
      else {
        tipo = await foundry.applications.api.DialogV2.wait({
          window: { title: game.i18n.localize("PYRO.CriarItem") },
          content: `<p class="hint">${game.i18n.localize("PYRO.CriarItemDica")}</p>`,
          buttons: tipos.map(t => ({
            action: t,
            label: game.i18n.localize(`TYPES.Item.${t}`)
          })),
          rejectClose: false
        });
        if (!tipo) return;
      }
    }

    await Item.implementation.create(
      { name: game.i18n.localize(`TYPES.Item.${tipo}`), type: tipo },
      { parent: this.actor, renderSheet: true }
    );
  }

  static #editarItem(event, target) {
    this.#getItem(target)?.sheet.render(true);
  }

  static async #excluirItem(event, target) {
    await this.#getItem(target)?.delete();
  }

  static async #usarItem(event, target) {
    await this.#getItem(target)?.usar();
  }

  static async #alternarEquipado(event, target) {
    const item = this.#getItem(target);
    if (item) await item.update({ "system.equipado": !item.system.equipado });
  }

  /** Favorito: o item passa a aparecer também na seção Favoritos, em Combate. */
  static async #alternarFavorito(event, target) {
    const item = this.#getItem(target);
    if (item) await item.setFlag("pyro", "favorito", !item.getFlag("pyro", "favorito"));
  }

  /** Enriquece os campos de texto da aba Notas. */
  async #notasEnriquecidas() {
    const actor = this.actor;
    const s = actor.system;
    const enrich = t => foundry.applications.ux.TextEditor.implementation.enrichHTML(
      t ?? "", { relativeTo: actor, secrets: actor.isOwner }
    );
    return {
      biografia: await enrich(s.biografia),
      pessoas: await enrich(s.pessoas),
      anotacoes: await enrich(s.anotacoes),
      livre1: await enrich(s.livre1?.texto),
      livre2: await enrich(s.livre2?.texto),
      mestre: actor.type === "npc" ? await enrich(s.notas) : ""
    };
  }

  /** Mana só aparece pra usuários de magia; energia, pra feitiçaria. */
  #recursosVisiveis() {
    const sys = this.actor.system;
    const concedidos = sys.recursosConcedidos ?? [];
    const out = [];
    for (const [chave, rec] of Object.entries(sys.recursos)) {
      const custom = PYRO.recursosCustom?.[chave];
      if (chave === "mana" && !sys.temMagia) continue;
      if (chave === "energia" && !sys.temFeiticos) continue;
      // Recursos personalizados só aparecem pra quem tem o caminho que concede.
      if (custom && !concedidos.includes(chave)) continue;

      // Recuperação por cena vira nota ao lado do rótulo, onde existir.
      const nota = rec.recuperacao
        ? game.i18n.format("PYRO.RecuperaPorCena", { valor: rec.recuperacao })
        : null;

      out.push({
        chave,
        value: rec.value,
        max: rec.max,
        pct: rec.max > 0 ? Math.clamp(Math.round((rec.value / rec.max) * 100), 0, 100) : 0,
        nota,
        label: custom
          ? game.i18n.localize(custom.label)
          : game.i18n.localize(`PYRO.Recursos.${chave}`)
      });
    }
    return out;
  }

  /**
   * Selos de poder: um por sistema que o personagem empunha (magia rúnica,
   * feitiçaria, energia natural e técnicas). Clicar num selo escolhe qual
   * deles tinge a ficha, e a escolha fica na flag "tema".
   *
   * O selo do mago aceita ainda uma cor específica entre as afinidades, na
   * flag "temaCor": o mago de gelo e o de fogo não precisam ter a mesma ficha.
   */
  #selosDePoder() {
    const actor = this.actor;
    const sys = actor.system;
    const loc = k => game.i18n.localize(k);
    const selos = [];
    const elementos = sys.afinidadesElementos ?? [];

    if (sys.temMagia) {
      // Cor escolhida à mão, quando ainda é uma afinidade válida. Senão a
      // primeira afinidade, e por último o acento padrão do sistema.
      const escolhida = actor.getFlag("pyro", "temaCor");
      const elemento = elementos.includes(escolhida)
        ? escolhida
        : (sys.afinidadesLista?.[0]?.cor ?? null);
      selos.push({
        chave: "mago",
        cor: elemento ? `var(--pyro-el-${elemento})` : "var(--pyro-brasa)",
        label: loc("PYRO.Vocacao.mago"),
        temCores: elementos.length > 0
      });
    }
    if (sys.temFeiticos) {
      selos.push({ chave: "feiticeiro", cor: "var(--pyro-sangue)", label: loc("PYRO.Vocacao.feiticeiro") });
    }
    // Vários recursos próprios ainda rendem um selo só: a marca é a mesma.
    if ((sys.recursosConcedidos ?? []).some(c => PYRO.recursosCustom?.[c])) {
      selos.push({ chave: "natural", cor: "var(--pyro-recurso-custom)", label: loc("PYRO.Vocacao.natural") });
    }
    if (sys.temTecnicas) {
      selos.push({ chave: "fisico", cor: "var(--pyro-vontade)", label: loc("PYRO.Vocacao.fisico") });
    }

    const escolhido = actor.getFlag("pyro", "tema");
    const principal = selos.find(s => s.chave === escolhido) ?? selos[0] ?? null;
    for (const selo of selos) {
      selo.ativo = selo === principal;
      selo.dica = game.i18n.format(
        selo.ativo && selo.temCores ? "PYRO.Vocacao.DicaCores" : "PYRO.Vocacao.DicaTema",
        { nome: selo.label }
      );
    }
    // A action lê isto para saber se o clique troca o tema ou abre as cores.
    this._vocacaoAtiva = principal?.chave ?? null;

    const corAtual = actor.getFlag("pyro", "temaCor");
    const coresElemento = principal?.chave === "mago"
      ? elementos.map(chave => ({
          chave,
          label: loc(PYRO.elementos[chave]?.label ?? chave),
          ativo: chave === corAtual,
          dica: game.i18n.format(
            chave === corAtual ? "PYRO.Vocacao.CorAutomatica" : "PYRO.Vocacao.CorElemento",
            { elemento: loc(PYRO.elementos[chave]?.label ?? chave) }
          )
        }))
      : [];

    return { selosPoder: selos, seloPrincipal: principal, coresElemento };
  }

  /** Clique num selo: troca o tema. No selo já ativo do mago, abre as cores. */
  static async #escolherVocacao(event, target) {
    const chave = target.dataset.vocacao;
    if (chave !== this._vocacaoAtiva) return this.actor.setFlag("pyro", "tema", chave);
    // Segundo clique no mago: uma amostra por elemento de afinidade. Abrir e
    // fechar é só uma classe, sem re-renderizar a ficha inteira.
    const cores = this.element.querySelector(".cores-vocacao");
    if (cores) cores.hidden = !cores.hidden;
  }

  /** Amostra de elemento: define a cor do selo do mago, ou volta à automática. */
  static async #escolherCorElemento(event, target) {
    const elemento = target.dataset.elemento;
    if (elemento === this.actor.getFlag("pyro", "temaCor")) {
      return this.actor.unsetFlag("pyro", "temaCor");
    }
    await this.actor.setFlag("pyro", "temaCor", elemento);
  }

  /**
   * Linha de identidade sob o nome: o que a ficha já sabe sobre o personagem,
   * montado a partir dos caminhos em vez de campos digitados.
   */
  #identidade() {
    const sys = this.actor.system;
    const partes = [];

    const racial = this.actor.items.get(sys.primeiroRacialId);
    if (racial) {
      const preset = PYRO.racas[racial.system.raca];
      // Usa o mesmo padrão de nome do caminho: em "Outro" o padrão é só
      // {detalhe}, então a ficha mostra "Raposa" e não "Outro (Raposa)".
      const detalhe = racial.system.racaDetalhe?.trim();
      const nome = preset
        ? game.i18n.format(preset.nome, { detalhe: detalhe ?? "" }).trim()
        : (detalhe ?? "");
      partes.push({
        texto: nome || game.i18n.localize(preset?.label ?? ""),
        classe: "id-raca"
      });
    }

    // Com caminho racial o tamanho é derivado, então entra como texto aqui;
    // sem ele, o cabeçalho mostra o select e esta parte não aparece.
    if (sys.primeiroRacialId) {
      partes.push({
        texto: game.i18n.localize(PYRO.tamanhos[sys.tamanho]?.label ?? ""),
        classe: "id-tamanho"
      });
    }

    for (const c of this.actor.items.filter(i => i.type === "caminho" && !i.system.ehRacial)) {
      partes.push({ texto: c.system.nomeCaminho || c.name, classe: "id-caminho" });
    }

    for (const af of sys.afinidadesLista ?? []) {
      partes.push({ texto: af.label, classe: "id-afinidade", cor: af.cor });
    }
    return partes;
  }

  /** Estados que precisam de aviso imediato, com ícone além da cor. */
  #alertas() {
    const sys = this.actor.system;
    const r = sys.recursos;
    const lista = [];

    if (r.estamina.value <= 0) {
      lista.push({
        texto: game.i18n.localize("PYRO.Alerta.SemEstamina"),
        icone: "fa-lungs", tom: "perigo"
      });
    }
    if (r.pv.max > 0 && r.pv.value / r.pv.max <= 0.25) {
      lista.push({
        texto: game.i18n.localize("PYRO.Alerta.PvBaixo"),
        icone: "fa-heart-crack", tom: "perigo"
      });
    }
    if (sys.sobrepeso) {
      lista.push({
        texto: game.i18n.format("PYRO.Alerta.Sobrepeso", {
          atual: sys.carga.atual, max: sys.carga.max
        }),
        icone: "fa-weight-hanging", tom: "aviso"
      });
    }
    if (sys.semAfinidade) {
      lista.push({
        texto: game.i18n.localize("PYRO.Item.PrecisaAfinidade"),
        icone: "fa-triangle-exclamation", tom: "aviso"
      });
    }
    return lista;
  }

  /** Menu único de recuperação, no lugar dos três botões fixos no cabeçalho. */
  static async #abrirRecuperacao() {
    const loc = k => game.i18n.localize(k);
    const escolha = await foundry.applications.api.DialogV2.wait({
      window: { title: loc("PYRO.Recuperar.Titulo") },
      content: `<p class="hint">${loc("PYRO.Recuperar.Explicacao")}</p>`,
      buttons: [
        { action: "cena", label: loc("PYRO.Recuperar.Cena"), icon: "fa-solid fa-hourglass-start" },
        { action: "capitulo", label: loc("PYRO.Recuperar.Capitulo"), icon: "fa-solid fa-hourglass-half" },
        { action: "arco", label: loc("PYRO.Recuperar.Arco"), icon: "fa-solid fa-hourglass-end" }
      ],
      rejectClose: false
    });
    if (escolha === "cena") return this.actor.recuperarCena();
    if (escolha === "capitulo") return this.actor.recuperarCapitulo();
    if (escolha === "arco") return this.actor.recuperarArco();
  }



  #getItem(target) {
    const li = target.closest("[data-item-id]");
    return this.actor.items.get(li?.dataset.itemId);
  }

  /* ---------------------------------------------------------------------- */
  /*  Linhas de lista (view model comum a todas as abas)                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Monta as linhas de uma lista. `montar` devolve o que muda por tipo:
   * detalhes (colunas), linha2, resumo (pares label/valor) e flags de equipar.
   */
  async #linhas(itens, montar) {
    const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    const usaveis = ["arma", "consumivel", "habilidade", "feitico", "magia", "runa"];
    return Promise.all(itens.map(async item => ({
      id: item.id,
      img: item.img,
      name: item.name,
      detalhes: [],
      cauda: [],
      // Ícone de d20 que aparece no hover e dispara o mesmo "usar" do menu.
      usavel: usaveis.includes(item.type),
      // Favoritável = o que se usa ou equipa em combate (runa e caminho não).
      favoritavel: ["arma", "equipamento", "consumivel", "habilidade", "feitico", "magia"]
        .includes(item.type),
      favorito: !!item.getFlag("pyro", "favorito"),
      descricaoHTML: await enrich(item.system.descricao ?? "", {
        relativeTo: item, secrets: item.isOwner
      }),
      ...montar(item)
    })));
  }

  /** Abre e fecha o resumo da linha (clique com o botão esquerdo no nome). */
  static #alternarResumo(event, target) {
    target.closest(".linha-item")?.classList.toggle("aberto");
  }

  /* ---------------------------------------------------------------------- */
  /*  Menu de contexto e reordenação                                        */
  /* ---------------------------------------------------------------------- */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#criarMenuContexto();
    this.#ativarArraste();
  }

  /**
   * O selo escolhido tinge a ficha: acento dos ornamentos e marca d'água do
   * cabeçalho. Sem selos, a ficha fica no acento padrão, sem marca.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const principal = context.seloPrincipal ?? null;
    this.element.style.setProperty("--pyro-acento-ficha", principal?.cor ?? "var(--pyro-brasa)");
    for (const chave of ["mago", "feiticeiro", "natural", "fisico"]) {
      this.element.classList.toggle(`marca-${chave}`, principal?.chave === chave);
    }
  }

  #criarMenuContexto() {
    const Menu = foundry.applications.ux.ContextMenu.implementation
      ?? foundry.applications.ux.ContextMenu;
    const item = li => this.actor.items.get(li.dataset.itemId);

    new Menu(this.element, ".linha-item", [
      {
        name: "PYRO.Menu.Usar",
        icon: '<i class="fa-solid fa-dice-d20"></i>',
        condition: li => ["arma", "consumivel", "habilidade", "feitico", "magia", "runa"]
          .includes(item(li)?.type),
        callback: li => item(li)?.usar()
      },
      {
        name: "PYRO.Menu.MostrarNoChat",
        icon: '<i class="fa-solid fa-comment"></i>',
        callback: li => item(li)?.mostrarNoChat()
      },
      {
        name: "PYRO.Menu.Editar",
        icon: '<i class="fa-solid fa-pen"></i>',
        callback: li => item(li)?.sheet.render(true)
      },
      {
        name: "PYRO.Menu.Duplicar",
        icon: '<i class="fa-solid fa-copy"></i>',
        callback: async li => {
          const original = item(li);
          if (original) {
            await Item.implementation.create(original.toObject(), { parent: this.actor });
          }
        }
      },
      {
        name: "PYRO.Menu.Excluir",
        icon: '<i class="fa-solid fa-trash"></i>',
        callback: async li => {
          const alvo = item(li);
          if (!alvo) return;
          const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize("PYRO.Menu.Excluir") },
            content: `<p>${game.i18n.format("PYRO.Menu.ExcluirAviso", { nome: alvo.name })}</p>`
          });
          if (ok) await alvo.delete();
        }
      }
    ], { jQuery: false, fixed: true });
  }

  /** Arrastar para reordenar dentro da própria lista. */
  #ativarArraste() {
    const raiz = this.element;

    raiz.addEventListener("dragstart", event => {
      const li = event.target.closest?.(".linha-item");
      if (!li) return;
      const item = this.actor.items.get(li.dataset.itemId);
      if (!item) return;
      event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
      li.classList.add("arrastando");
    });

    raiz.addEventListener("dragend", event => {
      event.target.closest?.(".linha-item")?.classList.remove("arrastando");
      raiz.querySelectorAll(".alvo-antes, .alvo-depois")
        .forEach(el => el.classList.remove("alvo-antes", "alvo-depois"));
    });

    raiz.addEventListener("dragover", event => {
      const li = event.target.closest?.(".linha-item");
      if (!li) return;
      event.preventDefault();
      const meio = li.getBoundingClientRect().top + li.offsetHeight / 2;
      li.classList.toggle("alvo-antes", event.clientY < meio);
      li.classList.toggle("alvo-depois", event.clientY >= meio);
    });

    raiz.addEventListener("dragleave", event => {
      event.target.closest?.(".linha-item")
        ?.classList.remove("alvo-antes", "alvo-depois");
    });

    raiz.addEventListener("drop", async event => {
      const li = event.target.closest?.(".linha-item");
      if (!li) return;
      // Impede que a ficha trate o mesmo drop como "adicionar item".
      event.preventDefault();
      event.stopPropagation();
      const antes = li.classList.contains("alvo-antes");
      li.classList.remove("alvo-antes", "alvo-depois");

      const dados = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const origem = await Item.implementation.fromDropData(dados);
      const alvo = this.actor.items.get(li.dataset.itemId);
      if (!origem || !alvo) return;

      // Item de fora da ficha: copia em vez de reordenar.
      if (origem.parent !== this.actor) {
        return Item.implementation.create(origem.toObject(), { parent: this.actor });
      }
      if (origem.id === alvo.id || origem.type !== alvo.type) return;
      await this.#ordenar(origem, alvo, antes);
    });
  }

  /** Reescreve o campo sort de todos os itens do tipo, na ordem nova. */
  async #ordenar(origem, alvo, antes) {
    const irmaos = this.actor.items
      .filter(i => i.type === origem.type)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      .filter(i => i.id !== origem.id);

    const posicao = irmaos.findIndex(i => i.id === alvo.id) + (antes ? 0 : 1);
    irmaos.splice(posicao, 0, origem);

    await this.actor.updateEmbeddedDocuments("Item", irmaos.map((i, n) => ({
      _id: i.id,
      sort: (n + 1) * CONST.SORT_INTEGER_DENSITY
    })));
  }

  /* ---------------------------------------------------------------------- */
  /*  Active Effects (estilo T20: temporários / passivos / inativos)        */
  /* ---------------------------------------------------------------------- */

  /** Junta efeitos do ator e os transferidos de itens (habilidades etc.). */
  #categoriasEfeitos() {
    const cats = { temporarios: [], passivos: [], inativos: [] };
    for (const ef of this.actor.allApplicableEffects()) {
      // Efeito preso a item não soma na ficha: a etiqueta diz onde ele vale,
      // senão pareceria um efeito passivo que simplesmente não funciona.
      const presoA = restricaoDoEfeito(ef).map(a => a.nome).filter(Boolean);
      const view = {
        uuid: ef.uuid,
        id: ef.id,
        img: ef.img,
        name: ef.name,
        disabled: ef.disabled,
        duracao: ef.duration?.label ?? "",
        restrito: presoA.join(", "),
        origem: ef.parent === this.actor ? "" : ef.parent?.name ?? ""
      };
      if (ef.disabled) cats.inativos.push(view);
      else if (ef.isTemporary) cats.temporarios.push(view);
      else cats.passivos.push(view);
    }
    return cats;
  }

  #getEfeito(target) {
    const uuid = target.closest("[data-effect-uuid]")?.dataset.effectUuid;
    return uuid ? fromUuidSync(uuid) : null;
  }

  static #criarEfeito(event, target) {
    new ConstrutorEfeitoApp({
      documento: this.actor,
      categoria: target.dataset.categoria ?? "passivos"
    }).render(true);
  }

  static #editarEfeito(event, target) {
    this.#getEfeito(target)?.sheet.render(true);
  }

  static async #excluirEfeito(event, target) {
    await this.#getEfeito(target)?.delete();
  }

  static async #alternarEfeito(event, target) {
    const ef = this.#getEfeito(target);
    if (ef) await ef.update({ disabled: !ef.disabled });
  }
}
