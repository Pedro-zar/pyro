/*
 * Ficha de ator (personagem e NPC): monta as listas de cada aba a partir dos
 * itens, aplica o tema escolhido e cuida da reordenação por arraste.
 */
import { PYRO } from "../config.mjs";
import { ConjuradorApp } from "../apps/conjurador.mjs";
import { NovoCaminhoApp } from "../apps/novo-caminho.mjs";
import { GuiaAcoesApp } from "../apps/guia-acoes.mjs";
import { ConstrutorEfeitoApp } from "../apps/construtor-efeito.mjs";
import { restricaoDoEfeito, nivelExaustao, aplicarExaustao, ehExaustao, niveisDoEfeito } from "../efeitos.mjs";
import { rotuloDePrazo } from "../duracao.mjs";
import { pilhasDe, efeitosDetalhados } from "../condicoes.mjs";

/** Condições que aparecem na barra de alertas, com o ícone de cada uma. */
const ICONES_DE_CONDICAO = {
  friagem: "fa-snowflake",
  molhado: "fa-droplet",
  queimando: "fa-fire"
};

import { selosDePoder, pintarTema } from "../tema.mjs";
import { SYSTEM_ID, caminho } from "../sistema.mjs";
import { enriquecer } from "../ui.mjs";
import { descreverRequisito } from "../progressao.mjs";
import { posturasDoAtor, tracosDaTecnica, valorDoTraco, textoDaCondicao } from "../tecnica.mjs";

/**
 * O que fazer com um drop que caiu em cima de uma linha do inventário.
 *
 * Só a reordenação interna é da ficha. Todo o resto — item de compêndio, item
 * de outra ficha, ator, efeito — fica com o Foundry, que já sabe criar; se a
 * ficha também criasse, o item entraria duas vezes.
 *
 * A decisão sai do uuid do arrasto porque precisa ser síncrona: depois de um
 * await o evento já foi entregue aos outros ouvintes e não há mais o que barrar.
 * @returns {{acao: "passar"|"reordenar", id?: string}}
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
 * Os grupos saem na ordem da lista de caminhos, e dentro de cada um a
 * habilidade base vem primeiro, depois as demais por tier.
 * Habilidades gerais e as que ficaram sem caminho (o item foi apagado) fecham
 * a lista, cada grupo com o próprio título. Caminho sem habilidade não vira
 * cabeçalho vazio.
 */
export function gruposDeHabilidades(caminhos, habilidades) {
  // Base primeiro, depois por tier e nome.
  const porTier = (a, b) => Number(b.system.ehBase) - Number(a.system.ehBase)
    || (a.system.tier ?? 1) - (b.system.tier ?? 1)
    || a.name.localeCompare(b.name);

  const grupos = caminhos.map(c => ({ chave: c.id, titulo: c.name, itens: [] }));
  const geral = { chave: "geral", titulo: "PYRO.CaminhoGeral", itens: [] };
  const semCaminho = { chave: "semCaminho", titulo: "PYRO.CaminhoRemovido", itens: [] };

  for (const h of habilidades) {
    const dono = grupos.find(g => g.chave === h.system.caminho);
    if (dono) dono.itens.push(h);
    else if (!h.system.caminho || h.system.caminho === "geral") geral.itens.push(h);
    else semCaminho.itens.push(h);
  }

  const todos = [...grupos, semCaminho, geral];
  for (const g of todos) g.itens.sort(porTier);
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
      vontadeDeViver: PyroActorSheet.#vontadeDeViver,
      ajustarExaustao: PyroActorSheet.#ajustarExaustao,
      recuperar: PyroActorSheet.#recuperar,
      abrirRecuperacao: PyroActorSheet.#abrirRecuperacao,
      abrirConjurador: PyroActorSheet.#abrirConjurador,
      abrirNovoCaminho: PyroActorSheet.#abrirNovoCaminho,
      alternarPostura: PyroActorSheet.#alternarPostura,
      abrirGuiaAcoes: PyroActorSheet.#abrirGuiaAcoes,
      criarItem: PyroActorSheet.#criarItem,
      editarItem: PyroActorSheet.#editarItem,
      excluirItem: PyroActorSheet.#excluirItem,
      usarItem: PyroActorSheet.#usarItem,
      ajudarPericia: PyroActorSheet.#ajudarPericia,
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
   * Abas fixas, agrupadas por atividade e não por tipo de dado. Só Poderes é
   * condicional; nas outras são as seções internas que aparecem e somem, para
   * a ficha não mudar de forma o tempo todo.
   */
  static PARTS = {
    header: { template: caminho("templates/actor/header.hbs") },
    atributos: { template: caminho("templates/actor/atributos.hbs") },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    combate: { template: caminho("templates/actor/tab-combate.hbs") },
    pericias: { template: caminho("templates/actor/tab-pericias.hbs") },
    poderes: { template: caminho("templates/actor/tab-poderes.hbs") },
    inventario: { template: caminho("templates/actor/tab-inventario.hbs") },
    progressao: { template: caminho("templates/actor/tab-progressao.hbs") },
    notas: { template: caminho("templates/actor/tab-notas.hbs") },
    efeitos: { template: caminho("templates/actor/tab-efeitos.hbs") }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "combate", icon: "fa-solid fa-hand-fist" },
        { id: "pericias", icon: "fa-solid fa-graduation-cap" },
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
    const umOuVarios = (n, um, varios) => loc(Number(n) === 1 ? um : varios);
    // Linha padrão das listas: nome + uma coluna só de detalhes por extenso.
    const detalheUnico = texto =>
      [{ texto, classe: "col-detalhes", dica: texto }];

    const linhaArma = item => {
      const sys = item.system;
      const danos = (sys.danos ?? []).filter(d => d.formula?.trim());
      const resumoDano = danos
        .map(d => `${d.formula} ${loc(PYRO.tiposDano[d.tipo]?.label ?? d.tipo).toLocaleLowerCase()}`)
        .join(" + ");
      const alcance = sys.alcanceMaximo > 0
        ? `${sys.alcanceMenor}/${sys.alcanceMaximo}m` : `${sys.alcanceMenor}m`;
      // "6d6 cortante, 2 ações, alcance 1m, peso 9"
      const detalheTexto = [
        resumoDano || null,
        sys.acoes ? `${sys.acoes} ${umOuVarios(sys.acoes, "PYRO.Custos.acao", "PYRO.Custos.acaoPlural")}` : null,
        `${loc("PYRO.Item.Alcance").toLocaleLowerCase()} ${alcance}`,
        `${loc("PYRO.PesoAbrev")} ${sys.peso}`
      ].filter(Boolean).join(", ");
      return {
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Item.Dano"), valor: resumoDano || "—" },
          { label: loc("PYRO.Acoes"), valor: sys.acoes },
          { label: loc("PYRO.Item.Maos"), valor: sys.maos },
          { label: loc("PYRO.Item.Alcance"), valor: alcance },
          { label: loc("PYRO.Item.UsaMunicao"), valor: loc(sys.usaMunicao ? "PYRO.Sim" : "PYRO.Nao") },
          { label: loc("PYRO.Peso"), valor: sys.peso },
          { label: loc("PYRO.Item.Custo"), valor: sys.custo },
          { label: loc("PYRO.Quantidade"), valor: sys.quantidade }
        ]
      };
    };

    const linhaEquipamento = item => {
      const sys = item.system;
      const defesas = [];
      for (const [cat, val] of Object.entries(sys.defesas.categorias)) {
        if (val) defesas.push(`${loc(PYRO.categoriasDano[cat])} +${val}`);
      }
      for (const [tipo, val] of Object.entries(sys.defesas.tipos)) {
        if (val) defesas.push(`${loc(PYRO.tiposDano[tipo].label)} +${val}`);
      }
      // Mochila e item arcano carregam um número que só eles têm: ele vai
      // junto na linha, senão a lista deles não diria nada de útil.
      const extra = [];
      if (sys.categoria === "mochila" && sys.cargaBonus) {
        extra.push({ chave: "PYRO.Item.CargaBonus", texto: `+${sys.cargaBonus}` });
      }
      if (sys.categoria === "arcano" && sys.reducaoMana) {
        extra.push({ chave: "PYRO.Item.ReducaoMana", texto: `-${sys.reducaoMana}` });
      }
      // "Costas, carga extra +54, peso 1"
      const detalheTexto = [
        loc(PYRO.partesCorpo[sys.parte] ?? "") || null,
        ...extra.map(e => `${loc(e.chave).toLocaleLowerCase()} ${e.texto}`),
        `${loc("PYRO.PesoAbrev")} ${sys.peso}`
      ].filter(Boolean).join(", ");
      return {
        equipavel: true,
        equipado: sys.equipado,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Item.Parte"), valor: loc(PYRO.partesCorpo[sys.parte] ?? "") },
          ...extra.map(e => ({ label: loc(e.chave), valor: e.texto })),
          { label: loc("PYRO.Defesas"), valor: defesas.join(" · ") || "—" },
          { label: loc("PYRO.Bloquear"), valor: sys.bloqueio || "—" },
          { label: loc("PYRO.Esquivar"), valor: sys.esquiva || "—" },
          { label: loc("PYRO.Peso"), valor: sys.peso },
          { label: loc("PYRO.Item.Custo"), valor: sys.custo },
          { label: loc("PYRO.Quantidade"), valor: sys.quantidade }
        ]
      };
    };

    const linhaConsumivel = item => {
      const sys = item.system;
      const tipoDano = loc(PYRO.tiposDano[sys.tipoDano]?.label ?? "");
      /*
       * "munição, perfurante, Costas, 20 unidades, peso 1" ou
       * "2d4, 1 ação, 3 unidades, peso 2". Munição pesa 1 no total, não
       * importa a quantidade nem o peso digitado; o custo fica no resumo.
       */
      const detalheTexto = [
        sys.municao ? loc("PYRO.Item.MunicaoTag") : null,
        sys.municao ? (tipoDano.toLocaleLowerCase() || null) : null,
        sys.formula || null,
        sys.municao
          ? (loc(PYRO.partesCorpo[sys.parte] ?? "") || null)
          : (sys.acoes ? `${sys.acoes} ${umOuVarios(sys.acoes, "PYRO.Custos.acao", "PYRO.Custos.acaoPlural")}` : null),
        sys.quantidade
          ? `${sys.quantidade} ${umOuVarios(sys.quantidade, "PYRO.Item.Unidade", "PYRO.Item.UnidadePlural")}`
          : null,
        `${loc("PYRO.PesoAbrev")} ${sys.municao ? 1 : sys.peso}`
      ].filter(Boolean).join(", ");
      return {
        equipavel: sys.municao,
        // Sem botão de equipar, reserva o espaço dele: as linhas com e sem
        // munição alinham igual.
        espacoEquipar: !sys.municao,
        equipado: sys.equipado,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Item.Formula"), valor: sys.formula || "—" },
          ...(sys.municao ? [{ label: loc("PYRO.Item.TipoDano"), valor: tipoDano }] : []),
          { label: loc("PYRO.Quantidade"), valor: sys.quantidade },
          { label: loc("PYRO.Peso"),
            valor: sys.municao ? `1 (${loc("PYRO.Item.PesoLote")})` : sys.peso },
          { label: loc("PYRO.Item.Custo"), valor: sys.custo }
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
      const sys = item.system;
      const caminhoNome = actor.items.get(sys.caminho)?.name
        ?? loc(sys.caminho === "geral" ? "PYRO.CaminhoGeral" : "PYRO.CaminhoRemovido");
      // Só a ativável cobra: mostrar o custo de uma postura seria anunciar
      // uma cobrança que não acontece (ver PYRO.cobraCustoDeUso).
      const custosPartes = !PYRO.cobraCustoDeUso(sys) ? [] : [
        sys.custoEstamina ? `${sys.custoEstamina} ${loc("PYRO.Recursos.estamina").toLocaleLowerCase()}` : null,
        sys.custoMana ? `${sys.custoMana} ${loc("PYRO.Recursos.mana").toLocaleLowerCase()}` : null,
        sys.custoEnergia ? `${sys.custoEnergia} ${loc("PYRO.Recursos.energia").toLocaleLowerCase()}` : null,
        sys.custoAcoes
          ? `${sys.custoAcoes} ${umOuVarios(sys.custoAcoes, `PYRO.Custos.${sys.tipoCusto}`, `PYRO.Custos.${sys.tipoCusto}Plural`)}`
          : null
      ].filter(Boolean);
      const custos = custosPartes.join(", ");
      /*
       * "Passiva, tier 1", "Ativável, 3 estamina, 1 ação, tier 1". Nos grupos
       * por caminho o cabeçalho do grupo já diz de onde a habilidade vem; fora
       * deles (técnicas, aba do caminho próprio, favoritos) o caminho abre a
       * lista.
       */
      const detalheTexto = [
        agrupada ? null : caminhoNome,
        sys.adormecidaAtiva ? loc("PYRO.Despertar.Tag") : null,
        loc(PYRO.categoriasHabilidade[sys.categoria] ?? ""),
        ...custosPartes,
        `${loc("PYRO.Item.Tier").toLocaleLowerCase()} ${sys.tier}`,
        `${loc("PYRO.Uso.NivelAbrev")} ${sys.nivel}`
      ].filter(Boolean).join(", ");
      return {
        adormecida: sys.adormecidaAtiva,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("TYPES.Item.caminho"), valor: caminhoNome },
          { label: loc("PYRO.Item.Categoria"), valor: loc(PYRO.categoriasHabilidade[sys.categoria] ?? "") },
          { label: loc("PYRO.Item.Tier"), valor: sys.tier },
          { label: loc("PYRO.Item.CustoXp"), valor: sys.ehBase ? loc("PYRO.Item.BaseTag") : sys.custoXp },
          { label: loc("PYRO.Uso.Nivel"), valor: `${sys.nivel} / ${sys.nivelMax}` },
          ...(sys.escalaPorNivel ? [{ label: loc("PYRO.Item.EscalaPorNivel"), valor: sys.escalaPorNivel }] : []),
          { label: loc("PYRO.Item.Custos"), valor: custos || "—" },
          { label: loc("PYRO.Item.Formula"), valor: sys.formula || "—" }
        ]
      };
    };

    const todasHabilidades = porTipo("habilidade");
    // Agrupada por caminho para a lista; a versão plana (habilidades) serve
    // à contagem e aos favoritos.
    const gruposHab = gruposDeHabilidades(porTipo("caminho"),
      todasHabilidades.filter(i => !i.system.abaCaminho));
    const habilidadesGrupos = [];
    for (const g of gruposHab) {
      habilidadesGrupos.push({
        titulo: loc(g.titulo),
        itens: await this.#linhas(g.itens, i => habilidade(i, true))
      });
    }
    const habilidades = habilidadesGrupos.flatMap(g => g.itens);
    /*
     * Técnicas são um tipo próprio: a linha resume a ação base, a condição
     * imposta e o que cada traço rende no grau comprado, que é o que se
     * consulta antes de escolher o Esforço.
     */
    const tecnicas = await this.#linhas(porTipo("tecnica"), item => {
      const sys = item.system;
      const base = loc(PYRO.acoesBaseTecnica[sys.acaoBase]?.label ?? "");
      const condicao = textoDaCondicao(sys);
      const efeitos = tracosDaTecnica(sys).map(t =>
        `${loc(t.cfg.label)} ${valorDoTraco(t.cfg, t.grau, 1)} ${loc(t.cfg.unidade)}`);
      const acoes = `${sys.acoes} ${umOuVarios(sys.acoes,
        PYRO.acoesBaseTecnica[sys.acaoBase]?.reacao ? "PYRO.Custos.reacao" : "PYRO.Custos.acao",
        PYRO.acoesBaseTecnica[sys.acaoBase]?.reacao ? "PYRO.Custos.reacaoPlural" : "PYRO.Custos.acaoPlural")}`;
      const detalheTexto = [
        base, acoes, condicao,
        `${loc("PYRO.Item.Tier").toLocaleLowerCase()} ${sys.tier}`,
        `${loc("PYRO.Uso.NivelAbrev")} ${sys.progresso.nivel}`
      ].filter(Boolean).join(", ");
      const requisito = descreverRequisito(item);
      return {
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Tecnica.AcaoBase"), valor: base },
          { label: loc("PYRO.Acoes"), valor: sys.acoes },
          ...(condicao ? [{ label: loc("PYRO.Tecnica.Condicao"), valor: condicao }] : []),
          { label: loc("PYRO.Item.Tier"), valor: sys.tier },
          { label: loc("PYRO.Tecnica.Pontos"), valor: `${sys.pontos.gastos} / ${sys.pontos.disponiveis}` },
          { label: loc("PYRO.Tecnica.Tracos"), valor: efeitos.join(" · ") || "—" },
          { label: loc("PYRO.Uso.Nivel"), valor: `${sys.progresso.nivel} / ${sys.progresso.nivelMax}` },
          ...(requisito ? [{
            label: requisito.noMaximo ? "" : game.i18n.format("PYRO.Uso.ParaONivel", { nivel: requisito.nivel }),
            valor: requisito.texto
          }] : [])
        ]
      };
    });
    const habilidadesCaminho = await this.#linhas(
      todasHabilidades.filter(i => i.system.abaCaminho), habilidade);

    const feiticos = await this.#linhas(porTipo("feitico"), item => {
      const sys = item.system;
      return {
        detalhes: [{ texto: sys.formula, classe: "" }],
        cauda: [{
          texto: sys.custoAcoes || "",
          classe: "col-curto"
        }],
        resumo: [
          { label: loc("PYRO.Acoes"), valor: sys.custoAcoes },
          { label: loc("PYRO.Item.Formula"), valor: sys.formula || "—" }
        ]
      };
    });

    const pericias = await this.#linhas(porTipo("pericia"), item => {
      const sys = item.system;
      const atributos = sys.atributos.map(k => loc(PYRO.atributos[k])).join("/");
      const c = sys.progresso.contadores;
      const acumulado = [
        `${c.rotineiras} ${loc("PYRO.Rolagem.rotineiras").toLocaleLowerCase()}`,
        `${c.dificeis} ${loc("PYRO.Rolagem.dificeis").toLocaleLowerCase()}`,
        `${c.muitoDificeis} ${loc("PYRO.Rolagem.muitoDificeis").toLocaleLowerCase()}`
      ].join(", ");
      const requisito = descreverRequisito(item);
      const marcas = [
        sys.exigeFerramentas ? loc("PYRO.Pericia.FerramentasTag") : null,
        sys.contaSoSucesso ? loc("PYRO.Pericia.SoSucessoTag") : null
      ].filter(Boolean);
      return {
        ajudavel: true,
        detalhes: detalheUnico([atributos, ...marcas].join(", ")),
        cauda: [
          { texto: `${loc("PYRO.Uso.NivelAbrev")} ${sys.progresso.nivel}`, classe: "col-curto", dica: loc("PYRO.Uso.Nivel") }
        ],
        resumo: [
          { label: loc("PYRO.Pericia.Atributos"), valor: atributos || "—" },
          { label: loc("PYRO.Uso.Nivel"), valor: `${sys.progresso.nivel} / ${sys.progresso.nivelMax}` },
          { label: loc("PYRO.Pericia.Progresso"), valor: acumulado },
          ...(requisito ? [{
            label: requisito.noMaximo ? "" : game.i18n.format("PYRO.Uso.ParaONivel", { nivel: requisito.nivel }),
            valor: requisito.texto
          }] : []),
          ...(marcas.length ? [{ label: "", valor: marcas.join(", ") }] : [])
        ]
      };
    });

    const runas = await this.#linhas(porTipo("runa"), item => {
      const sys = item.system;
      const subtipo = sys.tipoRuna === "elemento"
        ? loc(PYRO.elementos[sys.subtipo]?.label ?? "") : "";
      // "Elemento: raio" quando há elemento; gesto e modificador ficam só com
      // o nome do tipo.
      const tipo = loc(PYRO.tiposRuna[sys.tipoRuna] ?? "");
      const detalheTexto = subtipo ? `${tipo}: ${subtipo.toLocaleLowerCase()}` : tipo;
      return {
        // Marcador lateral com a cor do elemento: ajuda a varrer a lista.
        cor: sys.tipoRuna === "elemento" && PYRO.elementos[sys.subtipo] ? sys.subtipo : null,
        detalhes: detalheUnico(detalheTexto),
        cauda: [],
        resumo: [
          { label: loc("PYRO.Item.TipoRuna"), valor: loc(PYRO.tiposRuna[sys.tipoRuna] ?? "") },
          ...(subtipo ? [{ label: loc("PYRO.Item.Subtipo"), valor: subtipo }] : []),
          { label: loc("PYRO.Item.Palavra"), valor: sys.palavra || "—" },
          { label: loc("PYRO.Item.Lingua"), valor: loc(PYRO.linguas[sys.lingua]?.label ?? "") }
        ]
      };
    });

    const magias = await this.#linhas(porTipo("magia"), item => {
      const runasTexto = item.system.runas.map(r => r.nome).join(" · ");
      // Cores dos elementos das runas: uma vira friso, várias viram gradiente.
      const cores = [];
      for (const ref of item.system.runas) {
        const runa = actor.items.get(ref.itemId);
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
        cauda: [{
          texto: `${loc("PYRO.Uso.NivelAbrev")} ${item.system.progresso.nivel}`,
          classe: "col-curto", dica: loc("PYRO.Uso.Nivel")
        }],
        resumo: [
          { label: loc("PYRO.Item.RunasDaMagia"), valor: runasTexto || "—" },
          ...(escalas.length ? [{ label: loc("PYRO.Item.ScalingNome"), valor: escalas.join(" · ") }] : [])
        ]
      };
    });

    const caminhos = await this.#linhas(porTipo("caminho"), item => {
      const sys = item.system;
      const afinidades = (sys.afinidades ?? [])
        .map(a => a.tipo === "outro" ? a.outro : PYRO.afinidades[a.tipo]?.label)
        .filter(Boolean).join(", ");
      const recursos = (sys.recursos ?? [])
        .map(r => loc(PYRO.recursosCustom[r]?.label ?? r)).join(", ");
      return {
        detalhes: [],
        cauda: [
          {
            texto: `${loc("PYRO.Abrev.xp")} ${sys.xpDisponivel}`,
            classe: "col-xp", dica: loc("PYRO.XpDisponivel")
          },
          {
            texto: `${loc("PYRO.Abrev.gasta")} ${sys.xpGasta}`,
            classe: "col-xp", dica: loc("PYRO.Item.XpGasta")
          },
          {
            texto: `${loc("PYRO.Abrev.tier")}1 ${sys.custosPorTier?.[0]?.custo ?? ""}`,
            classe: "col-xp", dica: loc("PYRO.Item.CustoPorTier")
          }
        ],
        /*
         * Só o que não dá para ler em outro lugar da linha. Raça e detalhe já
         * estão no nome do caminho, logo acima; potencial mágico e curva de
         * progressão são configuração do mundo, não característica do
         * personagem. Sobra o que muda de ficha para ficha.
         */
        resumo: [
          ...(sys.ehRacial ? [{ label: "", valor: loc("PYRO.Item.EhRacial") }] : []),
          { label: loc("PYRO.Item.Xp"), valor: `${sys.xpDisponivel} / ${sys.xp}` },
          ...(sys.usaMagia
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
    const favoritaveis = ["arma", "equipamento", "consumivel", "habilidade", "tecnica", "feitico", "magia", "pericia"];
    const favIds = new Set(actor.items
      .filter(i => favoritaveis.includes(i.type) && i.getFlag(SYSTEM_ID, "favorito"))
      .map(i => i.id));
    const favoritos = [
      ...pericias, ...tecnicas, ...habilidades, ...habilidadesCaminho, ...feiticos, ...magias,
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

    // Listas de duas colunas (nome + detalhes por extenso) não levam legenda
    // de colunas: um cabeçalho ali fica desconexo da lista.
    const colsHabilidade = { semLegenda: true };
    const secaoSemLegenda = (chave, itens) => secao(chave, itens, { semLegenda: true });

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
      armas: secaoSemLegenda("armas", armas),
      equipamentos: secaoSemLegenda("equipamentos", equipamentos),
      artefatos: secaoSemLegenda("artefatos", artefatos),
      arcanos: secaoSemLegenda("arcanos", arcanos),
      mochilas: secaoSemLegenda("mochilas", mochilas),
      municoes: secaoSemLegenda("municoes", municoes),
      consumiveis: secaoSemLegenda("consumiveis", consumiveis),
      feiticos: secao("feiticos", feiticos, {
        colNome: loc("PYRO.Col.feitico"),
        colunas: [col("formula", "")],
        cauda: [col("acoes", "col-curto")],
        legIcones: "leg-icones-1"
      }),
      magias: secao("magias", magias, {
        colNome: loc("PYRO.Col.magia"),
        colunas: [col("runas", "")],
        cauda: [col("nivel", "col-curto")],
        legIcones: "leg-icones-1"
      }),
      runas: secao("runas", runas, { semLegenda: true }),
      pericias: secao("pericias", pericias, { semLegenda: true }),
      caminhos: secao("caminhos", caminhos, {
        colNome: loc("PYRO.Col.caminho")
      })
    };

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
      exaustao: nivelExaustao(actor),
      // A DET só chega a 0 onde a mesa ligou a regra do prólogo.
      detMin: PYRO.regraAtiva("det0") ? 0 : 1,
      /*
       * Força de Vontade: os dois usos que dependem do estado da ficha, e não
       * de uma rolagem em andamento. Benefício e Inspiração vivem no diálogo
       * de teste, e a Sorte no card da rolagem — nenhum dos dois cabe aqui.
       */
      podeVontadeDeViver: actor.system.caido
        && actor.system.recursos.vontade.value >= PYRO.CUSTO_VONTADE_DE_VIVER,
      custoVontadeDeViver: PYRO.CUSTO_VONTADE_DE_VIVER,
      // Caminho novo custa 10 x os que já tem (SRD §2), e o botão mostra o
      // preço antes de abrir a janela de repartir a XP.
      custoNovoCaminho: PYRO.custoDoCaminhoNovo(caminhos.length),
      /*
       * Barra de posturas: uma por habilidade marcada como postura, com a
       * ativa em destaque. Só uma vale por vez (SRD Técnicas), e é por isso
       * que a escolha é uma barra e não uma caixa por habilidade.
       */
      posturas: posturasDoAtor(actor).map(p => ({
        id: p.id,
        nome: p.name,
        img: p.img,
        ativa: actor.posturaAtiva?.id === p.id
      })),
      recursosVisiveis,
      recursosCols,
      selosPoder,
      seloPrincipal,
      coresElemento,
      podeTrocarTema: actor.isOwner,
      identidade: this.#identidade(),
      alertas: this.#alertas(),
      efeitosSofridos: this.#efeitosSofridos(),
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
      biografiaHTML: await enriquecer(actor.system.biografia, actor),
      notas: await this.#notasEnriquecidas(),
      notasHTML: actor.type === "npc" ? await enriquecer(actor.system.notas, actor) : ""
    });
    return context;
  }

  async _preparePartContext(partId, context) {
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /**
   * Campos indexados (system.crencas.0) chegam do expandObject como objeto de
   * chaves numéricas. Os ArrayFields quebram assim, então voltam a ser array
   * antes do update — mesma correção que a ficha de item faz.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    const sys = data.system ?? {};
    for (const chave of ["crencas", "instintos"]) {
      if (sys[chave] && !Array.isArray(sys[chave])) {
        sys[chave] = Object.values(sys[chave]).map(v => String(v ?? ""));
      }
    }
    return data;
  }

  /* ---------------------------------------------------------------------- */
  /*  Actions                                                               */
  /* ---------------------------------------------------------------------- */

  static async #rolarAtributo(event, target) {
    // Shift+clique: rolagem rápida, sem diálogo.
    await this.actor.rolarAtributo(target.dataset.atributo, { rapido: event.shiftKey });
  }

  // Como nos atributos: clique abre a janela, Shift rola direto.
  static async #rolarEsquiva(event) {
    await this.actor.rolarEsquiva({ rapido: event.shiftKey });
  }

  static async #rolarBloqueio(event) {
    await this.actor.rolarBloqueio({ rapido: event.shiftKey });
  }

  static async #tomarAr() {
    await this.actor.tomarAr();
  }

  /** Entrar na postura, ou sair dela ao clicar na que já está ativa. */
  static async #alternarPostura(event, target) {
    await this.actor.alternarPostura(this.actor.items.get(target.dataset.itemId));
  }

  static async #vontadeDeViver() {
    await this.actor.vontadeDeViver();
  }

  /** -1/+1 de exaustão à mão: mesma trilha da sobrecarga e do sobrepeso. */
  static async #ajustarExaustao(event, target) {
    await aplicarExaustao(this.actor, Number(target.dataset.delta) || 0);
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

  static #abrirNovoCaminho() {
    new NovoCaminhoApp({ actor: this.actor }).render(true);
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

  static async #ajudarPericia(event, target) {
    await this.#getItem(target)?.ajudar();
  }

  static async #alternarEquipado(event, target) {
    const item = this.#getItem(target);
    if (item) await item.update({ "system.equipado": !item.system.equipado });
  }

  /** Favorito: o item passa a aparecer também na seção Favoritos, em Combate. */
  static async #alternarFavorito(event, target) {
    const item = this.#getItem(target);
    if (item) await item.setFlag(SYSTEM_ID, "favorito", !item.getFlag(SYSTEM_ID, "favorito"));
  }

  /** Enriquece os campos de texto da aba Notas. */
  async #notasEnriquecidas() {
    const actor = this.actor;
    const sys = actor.system;
    const enrich = texto => enriquecer(texto, actor);
    return {
      biografia: await enrich(sys.biografia),
      pessoas: await enrich(sys.pessoas),
      anotacoes: await enrich(sys.anotacoes),
      livre1: await enrich(sys.livre1?.texto),
      livre2: await enrich(sys.livre2?.texto),
      mestre: actor.type === "npc" ? await enrich(sys.notas) : ""
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
    if (chave !== this._vocacaoAtiva) return this.actor.setFlag(SYSTEM_ID, "tema", chave);
    // Segundo clique no mago: uma amostra por elemento de afinidade. Abrir e
    // fechar é só uma classe, sem re-renderizar a ficha inteira.
    const cores = this.element.querySelector(".cores-vocacao");
    if (cores) cores.hidden = !cores.hidden;
  }

  /** Amostra de elemento: define a cor do selo do mago, ou volta à automática. */
  static async #escolherCorElemento(event, target) {
    const elemento = target.dataset.elemento;
    if (elemento === this.actor.getFlag(SYSTEM_ID, "temaCor")) {
      return this.actor.unsetFlag(SYSTEM_ID, "temaCor");
    }
    await this.actor.setFlag(SYSTEM_ID, "temaCor", elemento);
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

  /**
   * Linhas do painel de efeitos da aba de combate: só o que o personagem está
   * sofrendo agora, com nome, número, o que faz e quanto ainda dura.
   */
  #efeitosSofridos() {
    const linhas = efeitosDetalhados(this.actor).map(e => ({
      chave: e.chave,
      // "Friagem (3): ..." — o número entre parênteses só quando ele existe.
      titulo: game.i18n.format("PYRO.Efeito.Linha", {
        nome: e.nome,
        valor: e.valor === null ? "" : ` (${e.valor})`,
        descricao: e.descricao
      }),
      prazo: e.prazo ? game.i18n.format("PYRO.Efeito.Restante", { prazo: e.prazo }) : ""
    }));
    return {
      linhas,
      // A regra das mentais ainda não desconta nada: quem lê a ficha precisa
      // saber disso, senão procuraria o efeito nos atributos.
      notaMental: linhas.some(l => PYRO.condicoesMentais[l.chave])
    };
  }

  /** Estados que precisam de aviso imediato, com ícone além da cor. */
  #alertas() {
    const sys = this.actor.system;
    const recursos = sys.recursos;
    const lista = [];

    if (recursos.estamina.value <= 0) {
      lista.push({
        texto: game.i18n.localize("PYRO.Alerta.SemEstamina"),
        icone: "fa-lungs", tom: "perigo"
      });
    }
    if (recursos.pv.max > 0 && recursos.pv.value / recursos.pv.max <= 0.25) {
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
    /*
     * Condições elementais entram aqui porque mudam a conta do turno seguinte
     * — quanto custa reagir, quanto dano vem — e o jogador precisa vê-las sem
     * abrir a aba de combate. O detalhe do que cada uma faz fica lá.
     */
    for (const [chave, icone] of Object.entries(ICONES_DE_CONDICAO)) {
      const pilhas = pilhasDe(this.actor, chave);
      if (!pilhas) continue;
      lista.push({
        texto: game.i18n.format("PYRO.Condicoes.ComPilhas", {
          nome: game.i18n.localize(PYRO.condicoes[chave]?.label ?? chave), n: pilhas
        }),
        icone, tom: "aviso"
      });
    }
    return lista;
  }

  /** Menu único de recuperação: cena, capítulo ou arco. */
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
    const usaveis = ["arma", "consumivel", "habilidade", "tecnica", "feitico", "magia", "runa", "pericia"];
    return Promise.all(itens.map(async item => ({
      id: item.id,
      img: item.img,
      name: item.name,
      detalhes: [],
      cauda: [],
      // Ícone de d20 que aparece no hover e dispara o mesmo "usar" do menu.
      usavel: usaveis.includes(item.type),
      // Favoritável = o que se usa ou equipa em combate (runa e caminho não).
      favoritavel: ["arma", "equipamento", "consumivel", "habilidade", "tecnica", "feitico", "magia", "pericia"]
        .includes(item.type),
      favorito: !!item.getFlag(SYSTEM_ID, "favorito"),
      descricaoHTML: await enriquecer(item.system.descricao, item),
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
        condition: li => ["arma", "consumivel", "habilidade", "feitico", "magia", "runa", "pericia"]
          .includes(item(li)?.type),
        callback: li => item(li)?.usar()
      },
      {
        name: "PYRO.Pericia.Ajudar",
        icon: '<i class="fa-solid fa-hands-helping"></i>',
        condition: li => item(li)?.type === "pericia",
        callback: li => item(li)?.ajudar()
      },
      {
        name: "PYRO.Despertar.Nome",
        icon: '<i class="fa-solid fa-sun"></i>',
        condition: li => !!item(li)?.system.adormecidaAtiva,
        callback: li => item(li)?.despertar()
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
     * Reordenar é da ficha; trazer item de fora é do Foundry.
     *
     * O ActorSheetV2 escuta "drop" neste mesmo elemento e cria o item que vem
     * de compêndio ou de outra ficha. Um stopPropagation aqui não o silencia
     * (só cala ouvintes dos elementos acima), então o ouvinte vai na fase de
     * captura, que roda antes de qualquer ouvinte de bolha, e usa
     * stopImmediatePropagation — apenas no caso nosso, arrastar uma linha para
     * outro lugar da mesma ficha. Todo o resto passa intacto ao Foundry.
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
        duracao: rotuloDePrazo(ef),
        // Exaustão mostra o número de níveis ao lado do nome: ele mora na
        // flag, não no nome, então a linha precisa dizer.
        exaustao: ehExaustao(ef) ? niveisDoEfeito(ef) : null,
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
