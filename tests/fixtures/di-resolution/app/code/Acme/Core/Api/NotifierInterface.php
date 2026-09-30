<?php
declare(strict_types=1);

namespace Acme\Core\Api;

interface NotifierInterface
{
    public function notify(): void;
}
