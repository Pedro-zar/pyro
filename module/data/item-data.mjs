import { PYRO } from "../config.mjs";

const fields = foundry.data.fields;

const num = (initial, opts = {}) =>
  new fields.NumberField({ required: true, integer: true, initial, ...opts });

const dec = (initial, opts = {}) =>
  new fields.NumberField({ required: true, initial, ...opts });

const str = (initial = "", opts = {}) =>
  new fields.StringField({ required: true, initial, ...opts });

class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return { descricao: new fields.HTMLField() };
  }
}

/* ---------------------- Vínculo habilidade <-> caminho --------------------- */

/**
 * O campo `caminho` da habilidade guarda o id do Caminho, mas fichas antigas
 * guardavam o nome. Resolve os dois para o id, senão a mesma fila de XP se
 * parte em duas quando um item usa uma forma e outro usa a outra.
 */
export function idDoCaminho(actor, chave) {
  if (!chave) return "";
  if (actor?.items.get(chave)) return chave;
  const caminho = actor?.items.find(i => i.type === "caminho" && i.name === chave);
  return caminho?.id ?? chave;
}

/**
 * Quanto vale cada vaga na fila de habilidades. A escala já foi 10 (10, 20,
 * 30...) e hoje é 1 (1, 2, 3...). Fica isolado aqui para uma troca dessas ser
 * uma linha, e não uma caçada por multiplicações espalhadas.
 */
export const XP_POR_VAGA = 1;

/**
 * Curva de um Caminho: qual regra de progressão ele está usando.
 *
 * A regra é disparada pelo nome de uma habilidade do próprio Caminho, e a
 * varredura inclui a habilidade base de propósito — é ela que costuma carregar
 * o traço do Caminho, e ela não custa XP nem ocupa vaga.
 *
 * Quando nada bate, vale a curva padrão (uma unidade por vaga).
 */
export function progressaoDoCaminho(actor, caminho) {
  const indice = PYRO.progressaoPorNome;
  const padrao = { ...PYRO.progressaoPadrao, multiplicador: XP_POR_VAGA };
  if (!actor || !indice?.size) return padrao;

  const alvo = idDoCaminho(actor, caminho);
  if (!alvo) return padrao;

  // Quando mais de uma habilidade dispara regras diferentes, vale a que vem
  // antes na lista de configuração, e não a que estiver antes na ficha: a
  // ordem dos itens muda com arraste e criação, a da lista o mestre controla.
  let escolhida = null;
  for (const item of actor.items) {
    if (item.type !== "habilidade") continue;
    if (idDoCaminho(actor, item.system.caminho) !== alvo) continue;
    const regra = indice.get(PYRO.normalizarNome(item.name));
    if (!regra) continue;
    if (regra.posicao === 0) return regra;
    if (!escolhida || regra.posicao < escolhida.posicao) escolhida = regra;
  }
  return escolhida ?? padrao;
}

/**
 * Custo em XP de uma habilidade:
 *
 *   multiplicador x teto(posição / passo)
 *
 * Na curva padrão (passo 1, multiplicador 1) isso é a própria posição: 1, 2,
 * 3, 4. Com passo 2 vira 1, 1, 2, 2, 3, 3. A habilidade base do Caminho vem
 * junto dele e não custa nada.
 *
 * A posição é gravada na criação e não se mexe mais. Antes o custo era
 * recalculado por contagem, então editar a primeira habilidade de um caminho
 * com duas fazia ela custar o dobro: ela contava a irmã e ia para o fim da fila.
 */
export function custoDaHabilidade(sys, progressao = null) {
  if (sys?.ehBase) return 0;
  const ordem = Math.max(0, sys?.ordem ?? 0);
  if (!ordem) return 0;
  const passo = Math.max(1, progressao?.passo ?? 1);
  const mult = Number(progressao?.multiplicador ?? XP_POR_VAGA);
  // Arredondado porque o multiplicador aceita fração (meio preço) e XP é
  // sempre inteiro na ficha. Arredonda por habilidade, e não no total, para o
  // que a ficha mostra bater com o que ela soma.
  return Math.max(0, Math.round(mult * Math.ceil(ordem / passo)));
}

/** Posições já ocupadas por habilidades pagas de um Caminho. */
function ordensUsadas(actor, caminho, excluirId = null) {
  const alvo = idDoCaminho(actor, caminho);
  return new Set((actor?.items ?? [])
    .filter(i => i.type === "habilidade"
      && i.id !== excluirId
      && !i.system.ehBase
      && idDoCaminho(actor, i.system.caminho) === alvo)
    .map(i => i.system.ordem)
    .filter(n => Number.isInteger(n) && n > 0));
}

/**
 * Primeira posição livre do Caminho: se ninguém tem a 1, é a 1; senão tenta a
 * 2, e assim por diante. Apagar uma habilidade devolve a vaga dela para a
 * próxima que for criada.
 * @param {number} [preferida] mantém esta posição se ela estiver livre
 *   (usado ao mover uma habilidade de Caminho sem mudar o custo à toa).
 */
export function proximaOrdem(actor, caminho, { excluirId = null, preferida = 0 } = {}) {
  const usadas = ordensUsadas(actor, caminho, excluirId);
  if (Number.isInteger(preferida) && preferida > 0 && !usadas.has(preferida)) return preferida;
  let n = 1;
  while (usadas.has(n)) n++;
  return n;
}

/* ---------------------------- Arma ---------------------------------------- */

export class ArmaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Cada entrada é uma rolagem de dano com seu tipo. Aceita atributos
      // como bônus: "2d8 + @des" (ver Actor#getRollData).
      danos: new fields.ArrayField(new fields.SchemaField({
        formula: str("2d6"),
        tipo: str("impacto")
      }), { initial: [{ formula: "2d6", tipo: "impacto" }] }),
      usaMunicao: new fields.BooleanField({ initial: false }),
      acoes: num(2, { min: 1 }),
      maos: num(1, { min: 1, max: 2 }),
      // Alcance menor: até aqui o tiro é normal. Além dele, e até o máximo,
      // o teste de mira recebe desvantagem (SRD §5). 0 = corpo a corpo.
      alcanceMenor: num(0, { min: 0 }),
      alcanceMaximo: num(0, { min: 0 }),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }

  /** Migra dano/tipoDano/tiposDano antigos e o alcance em texto. */
  static migrateData(source) {
    if (typeof source.alcance === "string" && source.alcanceMenor === undefined) {
      const nums = source.alcance.match(/\d+/g)?.map(Number) ?? [0];
      source.alcanceMenor = nums[0] ?? 0;
      source.alcanceMaximo = nums[1] ?? nums[0] ?? 0;
      delete source.alcance;
    }
    if (source.danos === undefined && (source.dano !== undefined || source.tiposDano)) {
      const tipos = source.tiposDano ?? [source.tipoDano ?? "impacto"];
      source.danos = tipos.map((t, i) => ({
        formula: i === 0 ? (source.dano ?? "2d6") : "",
        tipo: t
      }));
      delete source.dano;
      delete source.tipoDano;
      delete source.tiposDano;
    }
    return super.migrateData(source);
  }
}

/* ---------------------------- Equipamento ---------------------------------- */

export class EquipamentoData extends BaseItemData {
  static defineSchema() {
    const tipos = Object.keys(PYRO.tiposDano).reduce((acc, t) => {
      acc[t] = num(0);
      return acc;
    }, {});
    return {
      ...super.defineSchema(),
      parte: str("peitoral", { choices: Object.keys(PYRO.partesCorpo) }),
      equipado: new fields.BooleanField({ initial: false }),
      // Bônus de defesa por categoria E por tipo específico.
      defesas: new fields.SchemaField({
        categorias: new fields.SchemaField({
          fisico: num(0), energetico: num(0), mental: num(0)
        }),
        tipos: new fields.SchemaField(tipos)
      }),
      // Dados extras somados às reações: "1d4" no bloqueio, "1d12" na esquiva.
      bloqueio: str(""),
      esquiva: str(""),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }

  /** Migra defesas antigas e a parte "escudo", que virou mãos. */
  static migrateData(source) {
    if (source.parte === "escudo") source.parte = "maos";
    const d = source.defesas;
    if (d && !("categorias" in d)) {
      source.defesas = {
        categorias: {
          fisico: d.fisico ?? 0,
          energetico: d.energetico ?? 0,
          mental: d.mental ?? 0
        },
        tipos: {}
      };
    }
    return super.migrateData(source);
  }
}

/* ---------------------------- Consumível ----------------------------------- */

export class ConsumivelData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      acoes: num(2, { min: 0 }),
      formula: str(""), // ex: "2d8" (cura) ou dano da munição ("2d10")
      municao: new fields.BooleanField({ initial: false }),
      tipoDano: str("perfurante"), // usado quando é munição
      // Munição pode ser presa nas costas ou na cintura.
      equipado: new fields.BooleanField({ initial: false }),
      parte: str("cintura"),
      peso: num(0, { min: 0 }),
      custo: num(0, { min: 0 }),
      quantidade: num(1, { min: 0 })
    };
  }
}

/* ---------------------------- Habilidade ----------------------------------- */

/** Habilidades de Caminho, gerais e técnicas marciais. */
export class HabilidadeData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      caminho: str(""), // id do Caminho de origem ("geral" para habilidades gerais)
      // Perícia, passiva ou ativável — organiza a lista da ficha.
      categoria: str("ativavel", { choices: Object.keys(PYRO.categoriasHabilidade) }),
      // Habilidades de caminhos de Classe podem ser técnicas (aba própria).
      ehTecnica: new fields.BooleanField({ initial: false }),
      // A habilidade base vem junto do caminho: não custa XP nem entra na
      // conta do custo da próxima habilidade.
      ehBase: new fields.BooleanField({ initial: false }),
      // Habilidades de caminhos que concedem recurso próprio (Energia Natural)
      // podem morar na aba daquele caminho.
      abaCaminho: new fields.BooleanField({ initial: false }),
      tier: num(1, { min: 1 }),
      /*
       * Posição na fila de habilidades pagas daquele Caminho, atribuída na
       * criação: a primeira vaga livre. É ela que fixa o custo, então uma
       * habilidade antiga não fica mais cara porque outras foram compradas
       * depois. 0 em habilidade base (não ocupa vaga e não custa XP).
       */
      ordem: num(1, { min: 0 }),
      // Vestigial: só a migração ainda lê este campo, para converter fichas
      // anteriores à posição fixa. O custo em jogo vem de custoDaHabilidade.
      custoXp: num(1, { min: 0 }),
      custoEstamina: num(0, { min: 0 }),
      custoMana: num(0, { min: 0 }),
      custoEnergia: num(0, { min: 0 }),
      custoAcoes: num(0, { min: 0 }),
      // A habilidade gasta ações do próprio turno ou reações fora dele.
      tipoCusto: str("acao", { choices: Object.keys(PYRO.tiposCusto) }),
      formula: str(""),
      /*
       * Aumento de atributo do tier (SRD §3): a habilidade dá tier - 1
       * pontos, distribuíveis entre atributos relacionados a ela. Cada
       * atributo entra uma vez só; a ficha soma isso no valor do atributo.
       */
      aumentos: new fields.ArrayField(new fields.SchemaField({
        atributo: str("for", { choices: Object.keys(PYRO.atributos) }),
        pontos: num(1, { min: 0 })
      }), { initial: [] })
    };
  }

  /**
   * Fichas anteriores à posição fixa: a vaga sai do custo já gravado. O
   * divisor é 10 porque é a escala em que aquele custo foi escrito, e não a
   * escala de hoje — uma habilidade que custava 30 era a terceira da fila,
   * e passa a custar 3.
   */
  static migrateData(source) {
    const ESCALA_ANTIGA = 10;
    if (source.ordem === undefined) {
      source.ordem = source.ehBase ? 0
        : Math.max(1, Math.round((source.custoXp ?? ESCALA_ANTIGA) / ESCALA_ANTIGA));
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    this.pontosAumento = Math.max(0, (this.tier ?? 1) - 1);
    this.pontosUsados = (this.aumentos ?? []).reduce((t, a) => t + (a.pontos ?? 0), 0);
    this.pontosRestantes = Math.max(0, this.pontosAumento - this.pontosUsados);
    // O custo é sempre derivado da posição e da curva do Caminho: o campo
    // gravado só serve de memória para fichas antigas, que a migração já
    // converteu. A curva é lida aqui, e não herdada do item de Caminho, porque
    // os itens são preparados em ordem e o Caminho pode vir depois.
    this.progressao = progressaoDoCaminho(this.parent?.actor, this.caminho);
    this.custoXp = custoDaHabilidade(this, this.progressao);
  }
}

/* ---------------------------- Feitiço --------------------------------------- */

/** Magia demoníaca (Humano Feiticeiro). Cru por enquanto, efeitos virão. */
export class FeiticoData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      custoAcoes: num(0, { min: 0 }),
      formula: str("")
    };
  }
}

/* ---------------------------- Runa ------------------------------------------ */

export class RunaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      tipoRuna: str("elemento", { choices: Object.keys(PYRO.tiposRuna) }),
      // Subtipo depende do tipoRuna; a ficha filtra as opções (e as afinidades
      // do mago limitam os elementos disponíveis).
      subtipo: str("fogo"),
      // A palavra/gesto em si ("Chamas", "Brasa").
      palavra: str(""),
      lingua: str("humana"), // línguas são configuráveis pelo mestre
      // Subjulgar: a rolagem compara com a vida do alvo, sem dano direto.
      // Nasce ligado no elemento Morte; magias de morte utilitárias desligam.
      subjulgar: new fields.BooleanField({ initial: false }),
      // Gestos ocupam mãos; a frase inteira não pode passar das mãos livres.
      maos: num(1, { min: 0 }),
      // Tipo de dano sobreposto: vazio usa o padrão do elemento (SRD permite
      // trocar para tipos físicos via gestos).
      tipoDano: str(""),
      /*
       * O que esta runa produz por Intenção:
       *   valor = floor(base + porIntencao x (Intenção - 1))
       * faces > 0 rola (valor)d(faces); faces 0 é um número plano (metros,
       * alvos, rodadas). Nasce preenchido pelas regras do elemento/gesto e
       * fica editável aqui — as magias montadas leem daqui.
       */
      scalings: new fields.ArrayField(new fields.SchemaField({
        nome: new fields.StringField({ required: true, initial: "" }),
        base: dec(0),
        porIntencao: dec(0),
        faces: num(0, { min: 0 })
      }), { initial: [] })
    };
  }

  /** Runas de Morte antigas subjulgavam por definição do elemento. */
  static migrateData(source) {
    if (source.subjulgar === undefined && source.tipoRuna === "elemento"
      && (PYRO.elementos?.[source.subtipo]?.subjulgar ?? source.subtipo === "morte")) {
      source.subjulgar = true;
    }
    return super.migrateData(source);
  }

  /** Elementos são verbais; formas e modificadores são gestos (somáticos). */
  get somatica() {
    return this.tipoRuna !== "elemento";
  }
}

/* ---------------------------- Magia (grimório) ------------------------------- */

/**
 * Uma frase rúnica salva. As Intenções são escolhidas a cada conjuração; os
 * escalonamentos entram como uma CÓPIA dos da runa no momento de salvar, e
 * ficam editáveis aqui — esta magia pode se comportar diferente da runa solta.
 * Magia salva sem cópia (antiga) continua lendo direto da runa.
 */
export class MagiaData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      runas: new fields.ArrayField(new fields.SchemaField({
        itemId: new fields.StringField({ required: true }),
        nome: new fields.StringField({ required: true }),
        subjulgar: new fields.BooleanField({ initial: false }),
        tipoDano: new fields.StringField({ required: true, initial: "" }),
        scalings: new fields.ArrayField(new fields.SchemaField({
          nome: new fields.StringField({ required: true, initial: "" }),
          base: dec(0),
          porIntencao: dec(0),
          faces: num(0, { min: 0 })
        }), { initial: [] })
      }))
    };
  }
}

/* ---------------------------- Caminho ---------------------------------------- */

export class CaminhoData extends BaseItemData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      // Caminho racial (raça) ou de profissão/classe.
      ehRacial: new fields.BooleanField({ initial: false }),
      // Nome livre da profissão/classe; vira "Caminho do <nome>".
      nomeCaminho: str(""),
      // Só relevantes em caminhos raciais:
      raca: str("humano"), // lista de raças é configurável pelo mestre
      racaDetalhe: str(""), // especialização escrita ("elfo (...)", "Outro"...)
      // Qualquer caminho (racial ou de classe) pode conceder magia/feitiçaria.
      usaMagia: new fields.BooleanField({ initial: false }),
      usaFeiticaria: new fields.BooleanField({ initial: false }),
      // Potencial mágico: mesma escala das línguas rúnicas (humana, élfica...).
      potencial: str("humana"),
      // Recursos personalizados concedidos por este caminho (Energia Natural etc).
      recursos: new fields.ArrayField(new fields.StringField({ required: true }), { initial: [] }),
      // Afinidades elementais do mago: lista de opções, "outro" com texto livre.
      afinidades: new fields.ArrayField(new fields.SchemaField({
        // Sem choices: as afinidades derivam dos elementos, que o mestre edita
        // nas configurações do mundo (validar aqui travaria chaves novas).
        tipo: new fields.StringField({ required: true, initial: "fogo" }),
        outro: new fields.StringField({ required: true, initial: "" })
      }), { initial: [] }),
      // O tamanho vem da raça; só o primeiro caminho racial do ator define.
      tamanho: str("medio", { choices: Object.keys(PYRO.tamanhos) }),
      xp: num(0, { min: 0 })
    };
  }

  /** Migra tipos antigos (profissao/classe) e afinidades em texto livre. */
  static migrateData(source) {
    if (source.tipoCaminho !== undefined) {
      source.ehRacial = source.tipoCaminho === "racial";
      delete source.tipoCaminho;
    }
    // Elfo (Mago) e Elfo (especificar) viraram um preset só.
    if (["elfoMago", "elfoOutro"].includes(source.raca)) source.raca = "elfo";
    // Humano (Mago) e Humano (Feiticeiro) também: a escolha virou checkbox,
    // então a capacidade que a raça dava é preservada aqui.
    if (source.raca === "humanoMago") {
      source.raca = "humano";
      if (!source.usaMagia) source.usaMagia = true;
    }
    if (source.raca === "humanoFeiticeiro") {
      source.raca = "humano";
      if (!source.usaFeiticaria) source.usaFeiticaria = true;
    }
    if (source.raca && source.usaMagia === undefined) {
      const preset = PYRO.racas[source.raca];
      if (preset) {
        source.usaMagia = preset.magia;
        source.usaFeiticaria = preset.feiticos;
        source.potencial = preset.potencial;
      }
    }
    if (typeof source.afinidades === "string") {
      const mapa = {
        fogo: "fogo", agua: "aguaGelo", gelo: "aguaGelo", ar: "arVento",
        vento: "arVento", pedra: "pedraTerra", terra: "pedraTerra",
        raio: "raio", vida: "vida", morte: "morte", espaco: "espaco", mente: "mente"
      };
      source.afinidades = source.afinidades.split(",")
        .map(t => t.trim()).filter(Boolean)
        .map(t => {
          const chave = mapa[t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
          return chave ? { tipo: chave, outro: "" } : { tipo: "outro", outro: t };
        });
    }
    return super.migrateData(source);
  }

  prepareDerivedData() {
    const actor = this.parent?.actor;
    // XP gasta é a soma do custo das habilidades deste caminho. O vínculo
    // aceita o id ou o nome, pra não quebrar fichas antigas.
    const habilidades = actor?.items.filter(i =>
      i.type === "habilidade"
      && idDoCaminho(actor, i.system.caminho) === this.parent.id
    ) ?? [];
    /*
     * Lê a posição gravada em vez do custo derivado da habilidade: os itens
     * são preparados em ordem, e um caminho preparado antes das habilidades
     * dele veria o custo ainda não calculado.
     */
    this.progressao = progressaoDoCaminho(actor, this.parent.id);
    this.xpGasta = habilidades.reduce(
      (t, i) => t + custoDaHabilidade(i.system, this.progressao), 0);
    this.xpDisponivel = this.xp - this.xpGasta;
    // A próxima habilidade ocupa a primeira vaga livre da fila.
    this.proximaOrdem = proximaOrdem(actor, this.parent.id);
    // O próprio "Próx." já denuncia a curva: com passo 2 ele repete o mesmo
    // número por duas vagas seguidas. Não precisa de aviso escrito na ficha.
    this.proximoCusto = custoDaHabilidade({ ordem: this.proximaOrdem }, this.progressao);
  }
}
