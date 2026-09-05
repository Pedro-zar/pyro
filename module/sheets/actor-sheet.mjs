import { PYRO } from "../config.mjs";
import { ConjuradorApp } from "../apps/conjurador.mjs";
import { GuiaAcoesApp } from "../apps/guia-acoes.mjs";
import { ConstrutorEfeitoApp } from "../apps/construtor-efeito.mjs";
import { restricaoDoEfeito } from "../efeitos.mjs";
import { selosDePoder, pintarTema } from "../tema.mjs";

/**
 * O que fazer com um drop que caiu em cima de uma linha do inventário.
 *
 * Só a reordenação interna é da ficha. Todo o resto — item de compêndio, item
 * de outra ficha, ator, efeito — volta para o Foundry, que já sabe criar. Com
 * os dois criando, o item entrava duas vezes.
 *
 * A decisão sai do uuid do arrasto porque precisa ser síncrona: depois de um
 * await o evento já foi entregue aos outros ouvintes e não há mais o que barrar.
 */
export function planoDeDrop(dados, atorUuid) {
  if (dados?.type !== "Item" || !atorUuid) return { acao: "passar" };
  const prefixo = `${atorUuid}.Item.`;
  if (!dados.uuid?.startsWith(prefixo)) return { acao: "passar" };
  return { acao: "reordenar", id: dados.uuid.slice(prefixo.length) };
}

/**
 * Agrupa as habilidades por caminho, para a lista da ficha.
 *
 * Os grupos saem na ordem da lista de caminhos, e dentro de cada um as
 * habilidades seguem a posição no caminho — a vaga de XP: base (vaga 0)
 * primeiro, depois 1, 2, 3... que é a ordem em que foram pegas. "Geral" e
 * habilidades de caminho apagado (agrupadas pelo nome que ficou gravado)
 * fecham a lista. Caminho sem habilidade não vira cabeçalho vazio.
 */
export function gruposDeHabilidades(caminhos, habilidades) {
  const porVaga = (a, b) => (a.system.ordem ?? 0) - (b.system.ordem ?? 0)
    || a.name.localeCompare(b.name);
  const donoDe = h => caminhos.find(c => c.id === h.system.caminho)
    ?? caminhos.find(c => c.name === h.system.caminho);

  const grupos = caminhos.map(c => ({ chave: c.id, titulo: c.name, ehGeral: false, itens: [] }));
  const geral = { chave: "geral", titulo: null, ehGeral: true, itens: [] };
  const orfaos = new Map();

  for (const h of habilidades) {
    const dono = donoDe(h);
    if (dono) {
      grupos.find(g => g.chave === dono.id).itens.push(h);
    } else if (!h.system.caminho || h.system.caminho === "geral") {
      geral.itens.push(h);
    } else {
      if (!orfaos.has(h.system.caminho)) {
        orfaos.set(h.system.caminho,
          { chave: h.system.caminho, titulo: h.system.caminho, ehGeral: false, itens: [] });
      }
      orfaos.get(h.system.caminho).itens.push(h);
    }
  }

  const todos = [...grupos, ...orfaos.values(), geral];
  for (const g of todos) g.itens.sort(porVaga);
  return todos.filter(g => g.itens.length);
}

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
    const ordenado = lista => lista.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const porTipo = tipo => ordenado(actor.items.filter(i => i.type === tipo));
    // Baldes do inventário: munição sai de consumíveis, e artefato, item
    // arcano e mochila saem de equipamentos (ver PYRO.categoriasItem).
    const porCategoria = chave =>
      ordenado(actor.items.filter(i => PYRO.itemNaCategoria(i, chave)));
    const loc = k => game.i18n.localize(k);
    // "1 ação" / "2 ações": as linhas escrevem tudo por extenso.
    const umOuVarios = (n, um, varios) => loc(Number(n) === 1 ? um : varios);
    // A linha padrão das listas: nome + uma coluna só de detalhes.
    const detalheUnico = texto =>
      [{ texto, classe: "col-detalhes", dica: texto }];

    const linhaArma = item => {
      const s = item.system;
      const danos = (s.danos ?? []).filter(d => d.formula?.trim());
      const resumoDano = danos
        .map(d => `${d.formula} ${loc(PYRO.tiposDano[d.tipo]?.label ?? d.tipo).toLocaleLowerCase()}`)
        .join(" + ");
      const alcance = s.alcanceMaximo > 0
        ? `${s.alcanceMenor}/${s.alcanceMaximo}m` : `${s.alcanceMenor}m`;
      // "6d6 cortante, 2 ações, alcance 1m, peso 9" — igual às habilidades.
      const detalheTexto = [
        resumoDano || null,
        s.acoes ? `${s.acoes} ${umOuVarios(s.acoes, "PYRO.Custos.acao", "PYRO.Custos.acaoPlural")}` : null,
        `${loc("PYRO.Item.Alcance").toLocaleLowerCase()} ${alcance}`,
        `${loc("PYRO.PesoAbrev")} ${s.peso}`
      ].filter(Boolean).join(", ");
      return {
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
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
    };

    const linhaEquipamento = item => {
      const s = item.system;
      const defesas = [];
      for (const [cat, val] of Object.entries(s.defesas.categorias)) {
        if (val) defesas.push(`${loc(PYRO.categoriasDano[cat])} +${val}`);
      }
      for (const [tipo, val] of Object.entries(s.defesas.tipos)) {
        if (val) defesas.push(`${loc(PYRO.tiposDano[tipo].label)} +${val}`);
      }
      // Mochila e item arcano carregam um número que só eles têm: ele vai
      // junto na linha, senão a lista deles não diria nada de útil.
      const extra = [];
      if (s.categoria === "mochila" && s.cargaBonus) {
        extra.push({ chave: "PYRO.Item.CargaBonus", texto: `+${s.cargaBonus}` });
      }
      if (s.categoria === "arcano" && s.reducaoMana) {
        extra.push({ chave: "PYRO.Item.ReducaoMana", texto: `-${s.reducaoMana}` });
      }
      // "Costas, carga extra +54, peso 1": parte, o que o item tem de
      // especial e o peso, tudo numa coluna só.
      const detalheTexto = [
        loc(PYRO.partesCorpo[s.parte] ?? "") || null,
        ...extra.map(e => `${loc(e.chave).toLocaleLowerCase()} ${e.texto}`),
        `${loc("PYRO.PesoAbrev")} ${s.peso}`
      ].filter(Boolean).join(", ");
      return {
        equipavel: true,
        equipado: s.equipado,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Item.Parte"), valor: loc(PYRO.partesCorpo[s.parte] ?? "") },
          ...extra.map(e => ({ label: loc(e.chave), valor: e.texto })),
          { label: loc("PYRO.Defesas"), valor: defesas.join(" · ") || "—" },
          { label: loc("PYRO.Bloquear"), valor: s.bloqueio || "—" },
          { label: loc("PYRO.Esquivar"), valor: s.esquiva || "—" },
          { label: loc("PYRO.Peso"), valor: s.peso },
          { label: loc("PYRO.Item.Custo"), valor: s.custo },
          { label: loc("PYRO.Quantidade"), valor: s.quantidade }
        ]
      };
    };

    const linhaConsumivel = item => {
      const s = item.system;
      const tipoDano = loc(PYRO.tiposDano[s.tipoDano]?.label ?? "");
      /*
       * "munição, perfurante, Costas, 20 unidades, peso 1" ou
       * "2d4, 1 ação, 3 unidades, peso 2": o que era coluna virou a lista por
       * extenso. Munição pesa 1 no total, não importa a quantidade nem o
       * peso digitado; o custo em moedas fica no resumo.
       */
      const detalheTexto = [
        s.municao ? loc("PYRO.Item.MunicaoTag") : null,
        s.municao ? (tipoDano.toLocaleLowerCase() || null) : null,
        s.formula || null,
        s.municao
          ? (loc(PYRO.partesCorpo[s.parte] ?? "") || null)
          : (s.acoes ? `${s.acoes} ${umOuVarios(s.acoes, "PYRO.Custos.acao", "PYRO.Custos.acaoPlural")}` : null),
        s.quantidade
          ? `${s.quantidade} ${umOuVarios(s.quantidade, "PYRO.Item.Unidade", "PYRO.Item.UnidadePlural")}`
          : null,
        `${loc("PYRO.PesoAbrev")} ${s.municao ? 1 : s.peso}`
      ].filter(Boolean).join(", ");
      return {
        equipavel: s.municao,
        // Sem botão de equipar, reserva o espaço dele: a linha alinha igual
        // nas linhas com e sem munição.
        espacoEquipar: !s.municao,
        equipado: s.equipado,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Item.Formula"), valor: s.formula || "—" },
          ...(s.municao ? [{ label: loc("PYRO.Item.TipoDano"), valor: tipoDano }] : []),
          { label: loc("PYRO.Quantidade"), valor: s.quantidade },
          { label: loc("PYRO.Peso"),
            valor: s.municao ? `1 (${loc("PYRO.Item.PesoLote")})` : s.peso },
          { label: loc("PYRO.Item.Custo"), valor: s.custo }
        ]
      };
    };

    const armas = await this.#linhas(porCategoria("arma"), linhaArma);
    const equipamentos = await this.#linhas(porCategoria("equipamento"), linhaEquipamento);
    const municoes = await this.#linhas(porCategoria("municao"), linhaConsumivel);
    const artefatos = await this.#linhas(porCategoria("artefato"), linhaEquipamento);
    const arcanos = await this.#linhas(porCategoria("arcano"), linhaEquipamento);
    const mochilas = await this.#linhas(porCategoria("mochila"), linhaEquipamento);
    const consumiveis = await this.#linhas(porCategoria("consumivel"), linhaConsumivel);

    const habilidade = (item, agrupada = false) => {
      const s = item.system;
      const caminho = actor.items.get(s.caminho)
        ?? actor.items.find(i => i.type === "caminho" && i.name === s.caminho);
      const caminhoNome = caminho?.name
        ?? (s.caminho === "geral" ? loc("PYRO.CaminhoGeral") : s.caminho);
      // A vaga de XP no caminho: hoje mora só no resumo, a linha ficou limpa.
      const posicao = s.ehBase ? loc("PYRO.Item.BaseTag") : `#${s.ordem}`;
      // Custos por extenso ("3 estamina, 1 ação"): abreviação era ruim de ler.
      const custosPartes = [
        s.custoEstamina ? `${s.custoEstamina} ${loc("PYRO.Recursos.estamina").toLocaleLowerCase()}` : null,
        s.custoMana ? `${s.custoMana} ${loc("PYRO.Recursos.mana").toLocaleLowerCase()}` : null,
        s.custoEnergia ? `${s.custoEnergia} ${loc("PYRO.Recursos.energia").toLocaleLowerCase()}` : null,
        s.custoAcoes
          ? `${s.custoAcoes} ${umOuVarios(s.custoAcoes, `PYRO.Custos.${s.tipoCusto}`, `PYRO.Custos.${s.tipoCusto}Plural`)}`
          : null
      ].filter(Boolean);
      const custos = custosPartes.join(", ");
      /*
       * Uma coluna só depois do nome, tudo por extenso: "Passiva, tier 1",
       * "Ativável, 3 estamina, 1 ação, tier 1". Nos grupos por caminho o
       * cabeçalho do grupo já diz de onde a habilidade vem; fora deles
       * (técnicas, aba do caminho próprio, favoritos) o caminho abre a lista.
       */
      const detalheTexto = [
        agrupada ? null : caminhoNome,
        loc(PYRO.categoriasHabilidade[s.categoria] ?? ""),
        ...custosPartes,
        `${loc("PYRO.Item.Tier").toLocaleLowerCase()} ${s.tier}`
      ].filter(Boolean).join(", ");
      return {
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("TYPES.Item.caminho"), valor: caminhoNome },
          { label: loc("PYRO.Item.Posicao"), valor: posicao },
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
    /*
     * A lista de habilidades sai agrupada por caminho, cada grupo na ordem
     * das vagas de XP. As linhas continuam nascendo do mesmo montador; o
     * flat (habilidades) segue existindo para contagem e favoritos.
     */
    const gruposHab = gruposDeHabilidades(porTipo("caminho"),
      todasHabilidades.filter(i => !i.system.ehTecnica && !i.system.abaCaminho));
    const habilidadesGrupos = [];
    for (const g of gruposHab) {
      habilidadesGrupos.push({
        titulo: g.ehGeral ? loc("PYRO.CaminhoGeral") : g.titulo,
        itens: await this.#linhas(g.itens, i => habilidade(i, true))
      });
    }
    const habilidades = habilidadesGrupos.flatMap(g => g.itens);
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
      const subtipo = s.tipoRuna === "elemento"
        ? loc(PYRO.elementos[s.subtipo]?.label ?? "") : "";
      // "Elemento: raio" quando há elemento; gesto e modificador ficam só com
      // o nome do tipo. A língua da runa mora no resumo.
      const tipo = loc(PYRO.tiposRuna[s.tipoRuna] ?? "");
      const detalheTexto = subtipo ? `${tipo}: ${subtipo.toLocaleLowerCase()}` : tipo;
      return {
        // Marcador lateral com a cor do elemento: ajuda a varrer a lista.
        cor: s.tipoRuna === "elemento" && PYRO.elementos[s.subtipo] ? s.subtipo : null,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
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
      ...armas, ...equipamentos, ...municoes, ...artefatos, ...arcanos,
      ...mochilas, ...consumiveis
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

    // Habilidades viraram duas colunas (nome + detalhes por extenso), sem
    // legenda no topo: cabeçalho de coluna ali ficava desconexo da lista.
    const colsHabilidade = { semLegenda: true };

    // Inventário unificado com as habilidades: linha em duas colunas (nome +
    // detalhes por extenso), sem legenda de colunas no topo. Os quatro baldes
    // de equipamento leem igual, e munição lê igual a consumível.
    const secaoEquip = (chave, itens) => secao(chave, itens, { semLegenda: true });
    const secaoConsumo = secaoEquip;

    const secoes = {
      favoritos: secao("favoritos", favoritos, { semLegenda: true }),
      tecnicas: secao("tecnicas", tecnicas, colsHabilidade),
      habilidades: secao("habilidades", habilidades, {
        ...colsHabilidade,
        grupos: habilidadesGrupos
      }),
      caminhoProprio: secao("caminhoProprio", habilidadesCaminho, {
        titulo: actor.system.abaCaminhoLabel || loc("PYRO.Secao.caminhoProprio"),
        ...colsHabilidade
      }),
      armas: secaoEquip("armas", armas),
      // Artefato, item arcano e mochila são equipamento por baixo, então
      // repetem as colunas dele; munição repete as de consumível.
      equipamentos: secaoEquip("equipamentos", equipamentos),
      artefatos: secaoEquip("artefatos", artefatos),
      arcanos: secaoEquip("arcanos", arcanos),
      mochilas: secaoEquip("mochilas", mochilas),
      municoes: secaoConsumo("municoes", municoes),
      consumiveis: secaoConsumo("consumiveis", consumiveis),
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
      runas: secao("runas", runas, { semLegenda: true }),
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

  /**
   * Receita de um item novo. O botão pode pedir um tipo cru ("runa") ou um
   * balde do inventário ("mochila"), que é tipo mais classificação — assim a
   * aba oferece Munição e Mochila sem o jogador ter que criar um consumível e
   * marcar uma caixa depois.
   */
  static #receitaDeItem(chave) {
    const cfg = PYRO.categoriasItem[chave];
    if (!cfg) {
      return { tipo: chave, nome: game.i18n.localize(`TYPES.Item.${chave}`), system: {} };
    }
    return {
      tipo: cfg.tipo,
      nome: game.i18n.localize(cfg.rotulo),
      system: {
        ...(cfg.categoria !== undefined ? { categoria: cfg.categoria } : {}),
        ...(cfg.municao !== undefined ? { municao: cfg.municao } : {})
      }
    };
  }

  static async #criarItem(event, target) {
    // Um botão traz um valor fixo; o da aba traz a lista daquela aba.
    const chaves = target.dataset.type
      ? [target.dataset.type]
      : (target.dataset.tipos ?? "").split(",").filter(Boolean);
    if (!chaves.length) return;

    let escolha = chaves[0];
    if (chaves.length > 1) {
      escolha = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.localize("PYRO.CriarItem") },
        content: `<p class="hint">${game.i18n.localize("PYRO.CriarItemDica")}</p>`,
        buttons: chaves.map(c => ({
          action: c,
          label: PyroActorSheet.#receitaDeItem(c).nome
        })),
        rejectClose: false
      });
      if (!escolha) return;
    }

    const receita = PyroActorSheet.#receitaDeItem(escolha);
    await Item.implementation.create(
      { name: receita.nome, type: receita.tipo, system: receita.system },
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
    // A conta mora em tema.mjs, porque as fichas de item, o construtor de
    // efeitos, o conjurador e os diálogos pintam o mesmo tema.
    const selos = selosDePoder(this.actor);
    // A action lê isto para saber se o clique troca o tema ou abre as cores.
    this._vocacaoAtiva = selos.seloPrincipal?.chave ?? null;
    return selos;
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
        ? PYRO.nomeDaRaca(racial.system.raca, detalhe ?? "")
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
   * cabeçalho. Sem selos, a ficha fica no acento padrão, sem marca. A pintura
   * em si está em tema.mjs, compartilhada com as outras janelas do ator.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    pintarTema(this.element, this.actor, { selo: context.seloPrincipal ?? null, marca: true });
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

    /*
     * Reordenar é nosso; trazer item de fora continua sendo do Foundry.
     *
     * O ActorSheetV2 escuta "drop" neste mesmo elemento e já cria o item que
     * vem de compêndio ou de outra ficha. Enquanto este ouvinte também criava,
     * o item entrava duas vezes — e stopPropagation não resolvia, porque ele
     * não silencia outro ouvinte do mesmo elemento, só os dos elementos acima.
     *
     * Daí a fase de captura: ela roda antes de qualquer ouvinte de bolha,
     * independentemente da ordem de registro, e aí stopImmediatePropagation
     * derruba o do Foundry. Só que o evento é engolido no caso que é nosso —
     * arrastar uma linha para outro lugar da mesma ficha. Todo o resto passa
     * intacto e chega a quem sabe tratar.
     */
    raiz.addEventListener("drop", event => {
      const li = event.target.closest?.(".linha-item");
      const antes = !!li?.classList.contains("alvo-antes");
      raiz.querySelectorAll(".alvo-antes, .alvo-depois")
        .forEach(el => el.classList.remove("alvo-antes", "alvo-depois"));
      if (!li) return;

      const dados = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      const plano = planoDeDrop(dados, this.actor.uuid);
      if (plano.acao !== "reordenar") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const origem = this.actor.items.get(plano.id);
      const alvo = this.actor.items.get(li.dataset.itemId);
      if (!origem || !alvo || origem.id === alvo.id || origem.type !== alvo.type) return;
      this.#ordenar(origem, alvo, antes);
    }, { capture: true });
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

  /**
   * Editar reabre o construtor do PYRO carregado com o efeito, e não a ficha
   * padrão do Foundry: é lá que dano, custo e restrição por item fazem
   * sentido. A ficha completa continua a um clique, no botão "abrir edição
   * completa" do próprio construtor.
   */
  static #editarEfeito(event, target) {
    const efeito = this.#getEfeito(target);
    if (efeito) new ConstrutorEfeitoApp({ efeito }).render(true);
  }

  static async #excluirEfeito(event, target) {
    await this.#getEfeito(target)?.delete();
  }

  static async #alternarEfeito(event, target) {
    const ef = this.#getEfeito(target);
    if (ef) await ef.update({ disabled: !ef.disabled });
  }
}
