<?php
declare(strict_types=1);

namespace Acme\Core\Model;

use Acme\Core\Api\NotifierInterface;

/** Backed enum implementing an interface: instanceof NotifierInterface. */
enum Mode: string implements NotifierInterface
{
    case Quiet = 'quiet';

    public function notify(): void
    {
    }
}
