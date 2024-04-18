<script lang="ts">

interface Navigator {
  serial: {
    // Define the methods and properties you need from the Web Serial API
    // For example:
    requestPort: (options?: SerialPortRequestOptions) => Promise<SerialPort>;
    getPorts: () => Promise<SerialPort[]>;
    // Add other properties and methods as needed
  };
}

</script>

<script setup lang="ts">
import 'xterm/css/xterm.css';
import {onBeforeMount, onMounted, reactive, ref, watch} from "vue";
import {ESPLoader, type FlashOptions, type IEspLoaderTerminal, type LoaderOptions, Transport} from "./lib_esptools-js";
import CryptoJS from "crypto-js";
import {useData} from 'vitepress';

const terminalContainer = ref();
let terminal: any;
let fitAddon: any;
const isDarkMode = useData().isDark;

watch(isDarkMode, value => {
  
});

const terminalConfig = {
  theme: {
    background: '#4b4b4b', // dark gray background
    foreground: '#c5c8c6', // light gray text
    cursor: '#f0c674',     // yellow cursor
    // You can also set specific ANSI colors if needed
    black: '#1d1f21',
    red: '#cc6666',
    convertEol: true,
    // ...and so on for other colors
  }
}

const notSupportedMsg = "您的浏览器不支持虚拟串口，请使用电脑版Chrome或者Edge。"

onBeforeMount(() => {
  if (!('serial' in navigator)) {
    alert(notSupportedMsg);
    console.log("Serial not supported");
  } else {
    console.log("serial ok");
    serialSupported.value = true;
  }
});

onMounted(async () => {
  if ('serial' in navigator) {
    const { Terminal } = await import('xterm');
    const { FitAddon } = await import('xterm-addon-fit');
    fitAddon = new FitAddon();
    terminal = new Terminal(terminalConfig);
    terminal.loadAddon(fitAddon);

    // Initialize the terminal
    // terminal.open(terminalContainer.value);
    terminal.open(terminalContainer.value);
    fitAddon.fit();

    // You can write some data to the terminal or set up your own handlers here
    terminal.writeln('请选择一个固件，连接后烧录。');

    const terminalResizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    })

    terminalResizeObserver.observe(terminalContainer.value);
  }
});

const chip = ref("");
const chip_type = ref("");
const programBaud = ref("115200");
const programBaudOption = [
  {text: '115200', value: '115200'},
  {text: '230400', value: '230400'},
  {text: '460800', value: '460800'},
  {text: '921600', value: '921600'},
]

const connectedBaud = ref("")
const programConnected = ref(false)
const serialSupported = ref(false);

const imageOption = [
  {
    value: '无线DAP-LINK_v0.3.1_esp32c3.bin',
    link: '/downloads/wireless_proxy_v0.3.1_esp32c3.bin',
    target: 'ESP32-C3',
  }, {
    value: '无线DAP-LINK_v0.3.1_esp32.bin',
    link: '/downloads/wireless_proxy_v0.3.1_esp32.bin',
    target: 'ESP32',
  },
]
const imageSelect = ref(imageOption[0]);

let transport: Transport | null;

let esploader: ESPLoader;

const espLoaderTerminal: IEspLoaderTerminal = {
  clean() {
    terminal.clear();
  },
  writeLine(data) {
    terminal.writeln(data);
  },
  write(data) {
    terminal.write(data);
  },
};

async function programConnect() {
  if (chip.value === "") {
    let port = await navigator.serial.requestPort({});
    transport = new Transport(port, true);
  }

  if (!transport) {
    return;
  }

  try {
    const flashOptions: LoaderOptions = {
      transport,
      romBaudrate: 115200,
      baudrate: parseInt(programBaud.value),
      terminal: espLoaderTerminal,
    };
    esploader = new ESPLoader(flashOptions);

    chip.value = await esploader.main();
    connectedBaud.value = programBaud.value;
    programConnected.value = true;

    chip_type.value = esploader.chip.CHIP_NAME;

    // Temporarily broken
    // await esploader.flashId();
  } catch (error) {
    let message = "";
    if (error instanceof Error) {
      message = error.message;
    }

    console.error(error);
    terminal.writeln(`Error: ${message}`);
  }

  binaryLoadStatus.status = "";
  binaryLoadStatus.progress = 0;
  console.log("Settings done for :" + chip.value);
}

function cleanUp() {
  transport = null;
  chip.value = "";
  chip_type.value = "";
}

// async function consoleConnectBtn() {
//   if (transport) {
//     await transport.disconnect();
//     await transport.waitForUnlock(1500);
//   }
//   terminal.reset();
//   cleanUp();
// }
//
// async function consoleResetBtn() {
//
// }

interface IBinImage {
  data: string;
  address: number;
}

function arrayBufferToBinaryString(buffer: ArrayBuffer) {
  const byteArray = new Uint8Array(buffer);
  let binaryString = '';
  byteArray.forEach((byte) => {
    binaryString += String.fromCharCode(byte);
  });
  return binaryString;
}

async function loadBinaryFile_back(imageLink: string) {
  try {
    const response = await fetch(imageLink);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.blob();
  } catch (error) {
    console.error('Error fetching the binary file:', error);
  }
}

/* cache the last binary, prevent user spam download */
const lastLoadedBinary = {
  link: "",
  blob: new Blob(),
}
const binaryLoadStatus = reactive({
  status: "未连接",
  progress: 0,
});

function updateProgress(loaded: number, total: number) {
  binaryLoadStatus.progress = Math.round((loaded / total) * 100);
}

async function loadBinaryFile(imageLink: string) {
  if (lastLoadedBinary.link === imageLink) {
    return lastLoadedBinary.blob;
  }

  try {
    binaryLoadStatus.progress = 0;
    binaryLoadStatus.status = "固件下载中";
    const response = await fetch(imageLink);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      throw new Error('Content-Length header is missing');
    }

    const total = parseInt(contentLength, 10);
    let loaded = 0;

    // Stream response body
    const reader = response.body.getReader();
    let chunks = []; // to store chunks of data
    let receivedLength = 0; // received that many bytes at the moment

    while(true) {
      const {done, value} = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      receivedLength += value.length;

      // report progress
      loaded += value.length;
      updateProgress(loaded, total);
    }

    // Concatenate chunks into single Uint8Array
    let chunksAll = new Uint8Array(receivedLength);
    let position = 0;
    for(let chunk of chunks) {
      chunksAll.set(chunk, position);
      position += chunk.length;
    }

    lastLoadedBinary.link = imageLink;
    lastLoadedBinary.blob = new Blob([chunksAll]); // Convert to blob
    binaryLoadStatus.status = "固件下载完成";
    return lastLoadedBinary.blob;
  } catch (error) {
    binaryLoadStatus.status = "固件下载错误";
    console.error('Error fetching the binary file:', error);
  }
}

async function programFlash() {
  const fileArray: IBinImage[] = [];

  if (chip_type.value != imageSelect.value.target) {
    alert(`烧录对象（${chip_type.value}）与固件（${imageSelect.value.value}）不匹配！`)
    return;
  }

  const blob = await loadBinaryFile(imageSelect.value.link);

  console.log(blob);
  if (blob && blob.size > 100000) {
    let data = arrayBufferToBinaryString(await blob.arrayBuffer());

    fileArray.push({
      data: data,
      address: 0x0,
    });
  } else {
    alert("???");
    return;
  }
  binaryLoadStatus.status = "固件烧录中";
  try {
    const flashOptions: FlashOptions = {
      fileArray: fileArray,
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      flashMode: "DIO",
      flashFreq: programBaud.value,
      reportProgress: (fileIndex, written, total) => {
        updateProgress(written, total);
        console.log(fileIndex, written, total);
      },
      calculateMD5Hash: (image) => {
        const hash = CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image));
        return hash.toString(CryptoJS.enc.Hex);
      },
    };
    await esploader.writeFlash(flashOptions);
  } catch (e) {
    let message = "";
    if (e instanceof Error) {
      message = e.message;
      terminal.writeln(`Error: ${message}`);
    }
    console.error(e);
  }
  binaryLoadStatus.status = "固件烧录完成";
  terminal.writeln("烧录完成，请断开连接，手动重启");
  await resetClick();
}

async function programErase() {
  try {
    await esploader.eraseFlash();
  } catch (e: any) {
    console.error(e);
    terminal.writeln(`Error: ${e?.message}`);
  }
}

async function programDisconnect() {
  if (transport) {
    await transport.disconnect();
    await transport.waitForUnlock(1500);
  }

  programConnected.value = false;
  chip.value = "";
  chip_type.value = "";
  connectedBaud.value = "";
  binaryLoadStatus.status = "未连接";
  terminal.reset();
}

async function resetClick() {
  if (transport) {
    await transport.setDTR(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await transport.setDTR(true);
  }
}

/* used for file upload */
async function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  const fileArray: IBinImage[] = [];

  const blob = await loadBinaryFile(imageSelect.value.link);
  if (blob) {

    let data = arrayBufferToBinaryString(await blob.arrayBuffer());
    console.log(blob.size, data);
  }

  if (files && files.length > 0) {
    const file = files[0];

    let data: string = arrayBufferToBinaryString(await file.arrayBuffer());
    fileArray.push({
      data: data,
      address: 0x0,
    })
    console.log(file, data);
  }
}

const customColors = [
  { color: '#f56c6c', percentage: 20 },
  { color: '#f5816c', percentage: 30 },
  { color: '#e6a23c', percentage: 40 },
  { color: '#e6be3c', percentage: 60 },
  { color: '#d5e63c', percentage: 80 },
  { color: '#ade63c', percentage: 95 },
  { color: '#019d30', percentage: 100 },
]

/* CONSOLE */
const consoleStarted = ref(false);

const consoleBaud = ref("115200");
const consoleBaudOption = [
  {text: '115200', value: '115200'},
  {text: '230400', value: '230400'},
  {text: '460800', value: '460800'},
  {text: '921600', value: '921600'},
]
const consoleBaudConnected = ref("");

async function consoleStartButton() {
  if (chip.value === "") {
    let port = await navigator.serial.requestPort({});
    transport = new Transport(port, true);
  } else {
    return;
  }

  if (!transport) {
    return;
  }

  terminal.reset();

  consoleBaudConnected.value = consoleBaud.value;
  await transport.connect(parseInt(consoleBaudConnected.value));
  consoleStarted.value = true;

  while (consoleStarted.value) {
    const val = await transport.rawRead();
    if (typeof val !== "undefined") {
      terminal.write(val);
    } else {
      break;
    }
  }
  console.log("quitting console");
}

async function consoleStopButton() {
  consoleStarted.value = false;
  if (transport) {
    await transport.disconnect();
    await transport.waitForUnlock(1500);
  }
  terminal.reset();
  cleanUp();
}

async function reset() {
  if (transport) {
    await transport.setDTR(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await transport.setDTR(true);
  }
}

</script>

<template>
  <div>
    <h1>在线ESP32烧录<span v-if="serialSupported">（免环境配置，免装软件）</span></h1>
    <el-divider></el-divider>
    <div v-show="serialSupported">
      <el-tabs>
        <el-tab-pane label="烧录" :disabled="consoleStarted">
          <el-alert type="info" class="mb-4"  show-icon>
            若无法连接，请先让ESP32进入下载模式，再尝试连接（按住BOOT，按一下RESET，松开BOOT）
          </el-alert>
          <el-form label-width="auto">
            <el-form-item label="固件">
              <client-only>
                <el-select
                    v-model="imageSelect"
                    placeholder="选择固件"
                >
                  <el-option
                      v-for="item in imageOption"
                      :key="item.value"
                      :label="item.value"
                      :value="item"
                  />
                </el-select>
              </client-only>
            </el-form-item>
            <el-form-item label="波特率">
              <client-only>
                <el-select
                    v-model="programBaud"
                    placeholder="选择波特率"
                >
                  <el-option
                      v-for="item in programBaudOption"
                      :key="item.value"
                      :label="item.value"
                      :value="item.value"
                  />
                </el-select>
              </client-only>
            </el-form-item>
            <el-form-item label="操作">
              <el-button v-if="!programConnected" @click="programConnect" type="primary">连接</el-button>
              <el-button v-show="programConnected" @click="programFlash" type="primary">烧录</el-button>
              <el-button v-show="programConnected" @click="programErase" type="danger">全片擦除</el-button>
              <el-button v-show="programConnected" @click="programDisconnect" type="info">断开连接</el-button>
            </el-form-item>
            <el-form-item label="已连接" v-show="programConnected">
              <div class="flex gap-2">
                <el-tag type="primary">芯片型号 {{ chip }}</el-tag>
                <el-tag type="success">波特率 {{ connectedBaud }}</el-tag>
                <!--            <el-tag type="info">Tag 3</el-tag>-->
                <!--            <el-tag type="warning">Tag 4</el-tag>-->
                <!--            <el-tag type="danger">Tag 5</el-tag>-->
              </div>
            </el-form-item>
            <el-form-item label="状态" class="border" v-if="binaryLoadStatus.status">
              <div class="flex flex-row w-full">
                <el-text class="w-32">{{ binaryLoadStatus.status }}</el-text>
                <el-progress :percentage="binaryLoadStatus.progress" :color="customColors" class="w-full"/>
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="查看日志" :disabled="programConnected">
          <el-form label-width="auto">
            <el-form-item label="波特率">
              <client-only>
                <el-select
                    v-model="consoleBaud"
                    placeholder="选择波特率"
                >
                  <el-option
                      v-for="item in consoleBaudOption"
                      :key="item.value"
                      :label="item.value"
                      :value="item.value"
                  />
                </el-select>
              </client-only>
            </el-form-item>
            <el-form-item label="操作">
              <el-button v-if="!consoleStarted" @click="consoleStartButton" type="primary">连接</el-button>
              <el-button v-show="consoleStarted" @click="reset" type="info">重启</el-button>
              <el-button v-show="consoleStarted" @click="consoleStopButton" type="danger">断开连接</el-button>
            </el-form-item>
            <el-form-item label="状态" v-show="consoleStarted">
              <div class="flex gap-2">
                <el-tag type="success">已连接</el-tag>
                <el-tag type="primary">波特率 {{ consoleBaudConnected }}</el-tag>
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <!--    <input type="file" @change="handleFileChange"/>-->

      <div>
        <div id="terminal-container" ref="terminalContainer" class="terminal"></div>
      </div>
    </div>
    <div v-if="!serialSupported">
      <div class="text-center">
        <a href="/"><el-button type="primary">返回至首页</el-button></a>
      </div>
      <h2>{{notSupportedMsg}}</h2>
    </div>

  </div>
</template>

<style scoped>
.terminal {
  background-color: black;
}
</style>

<style>
.el-popper {
  transition: all 0.05s;
}
</style>
